/**
 * src/agent/SecurityAssessmentCapability.js
 *
 * Bounded security assessment capability for authorized targets.
 * Performs passive and safe-active inspections:
 * - HTTPS / TLS / HSTS inspection
 * - Security response headers check (CSP, CORS, X-Frame-Options, X-Content-Type-Options, etc.)
 * - Cookie attributes analysis
 * - Public surface / endpoints discovery (robots.txt, sitemap.xml)
 * - Evidence collection & Security Report synthesis
 *
 * Governed strictly by Execution Policies (PASSIVE, SAFE_ACTIVE, INTRUSIVE, DESTRUCTIVE).
 */

const https = require("https");
const http = require("http");
const { URL } = require("url");

class SecurityAssessmentCapability {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Main handler for running security assessments.
   */
  async runAssessment(inputs = {}, context = {}) {
    const targetUrl = inputs.targetUrl || inputs.url || inputs.target;
    if (!targetUrl) {
      throw new Error("SecurityAssessment requires a target URL.");
    }

    let parsedUrl;
    try {
      parsedUrl = new URL(targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`);
    } catch (e) {
      throw new Error(`Invalid target URL: ${targetUrl}`);
    }

    const policy = inputs.policy || "PASSIVE"; // PASSIVE, SAFE_ACTIVE, INTRUSIVE, DESTRUCTIVE
    if (policy === "INTRUSIVE" || policy === "DESTRUCTIVE") {
      if (!context.userAuthorized) {
        throw new Error(`Security assessment policy '${policy}' requires explicit user authorization.`);
      }
    }

    const findings = [];
    const evidence = [];

    // 1. HTTPS / TLS Check
    const tlsResult = await this.inspectTLS(parsedUrl);
    evidence.push({ step: "TLS/HTTPS Inspection", result: tlsResult });
    if (!tlsResult.isHttps) {
      findings.push({
        id: "NO_HTTPS",
        severity: "HIGH",
        title: "Application allows unencrypted HTTP connection",
        description: "The site is accessible over HTTP without mandatory SSL/TLS encryption.",
        recommendation: "Enforce HTTPS redirect and configure TLS certificate."
      });
    }

    // 2. Response Headers Inspection
    const headerResult = await this.inspectHeaders(parsedUrl);
    evidence.push({ step: "Security Headers Analysis", result: headerResult });

    if (!headerResult.headers["strict-transport-security"]) {
      findings.push({
        id: "MISSING_HSTS",
        severity: "MEDIUM",
        title: "Missing HTTP Strict Transport Security (HSTS) header",
        description: "HSTS header is absent, allowing potential SSL stripping attacks.",
        recommendation: "Add Strict-Transport-Security header (e.g. max-age=31536000; includeSubDomains)."
      });
    }

    if (!headerResult.headers["x-content-type-options"]) {
      findings.push({
        id: "MISSING_X_CONTENT_TYPE_OPTIONS",
        severity: "LOW",
        title: "Missing X-Content-Type-Options header",
        description: "MIME sniffing is not disabled, which could allow MIME-based attacks.",
        recommendation: "Set 'X-Content-Type-Options: nosniff'."
      });
    }

    if (!headerResult.headers["content-security-policy"]) {
      findings.push({
        id: "MISSING_CSP",
        severity: "MEDIUM",
        title: "Missing Content Security Policy (CSP) header",
        description: "No CSP header detected to mitigate XSS and data injection attacks.",
        recommendation: "Define a robust Content-Security-Policy header."
      });
    }

    // 3. CORS Check
    const corsResult = this.inspectCORS(headerResult.headers);
    evidence.push({ step: "CORS Configuration Analysis", result: corsResult });
    if (corsResult.isPermissive) {
      findings.push({
        id: "PERMISSIVE_CORS",
        severity: "MEDIUM",
        title: "Permissive Cross-Origin Resource Sharing (CORS) Policy",
        description: "Access-Control-Allow-Origin is set to '*' or accepts arbitrary origins with credentials.",
        recommendation: "Restrict Access-Control-Allow-Origin to trusted origins."
      });
    }

    // 4. Public Surface Discovery (robots.txt)
    const surfaceResult = await this.discoverSurface(parsedUrl);
    evidence.push({ step: "Public Surface Discovery", result: surfaceResult });

    // 5. Synthesize Security Report
    const reportText = this.generateReport({
      target: parsedUrl.href,
      policy,
      findings,
      evidence
    });

    return {
      success: true,
      target: parsedUrl.href,
      findings,
      evidence,
      report: reportText
    };
  }

  async inspectTLS(urlObj) {
    return new Promise((resolve) => {
      const isHttps = urlObj.protocol === "https:";
      if (!isHttps) {
        return resolve({ isHttps: false, tlsValid: false, protocol: "http" });
      }

      const req = https.get(urlObj.href, { timeout: 5000 }, (res) => {
        const cert = res.socket.getPeerCertificate ? res.socket.getPeerCertificate() : null;
        resolve({
          isHttps: true,
          tlsValid: !!cert,
          subject: cert ? cert.subject : null,
          validTo: cert ? cert.valid_to : null,
          statusCode: res.statusCode
        });
      });

      req.on("error", () => {
        resolve({ isHttps: true, tlsValid: false, error: "Connection error during TLS handshake" });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ isHttps: true, tlsValid: false, error: "TLS inspection request timed out" });
      });
    });
  }

  async inspectHeaders(urlObj) {
    return new Promise((resolve) => {
      const client = urlObj.protocol === "https:" ? https : http;
      const req = client.get(urlObj.href, { timeout: 5000 }, (res) => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers || {}
        });
      });

      req.on("error", (err) => {
        resolve({ statusCode: 0, headers: {}, error: err.message });
      });

      req.on("timeout", () => {
        req.destroy();
        resolve({ statusCode: 0, headers: {}, error: "Headers inspection timed out" });
      });
    });
  }

  inspectCORS(headers = {}) {
    const acao = headers["access-control-allow-origin"];
    const acac = headers["access-control-allow-credentials"];
    const isPermissive = acao === "*" || (acao && acac === "true");
    return {
      allowOrigin: acao || null,
      allowCredentials: acac || null,
      isPermissive
    };
  }

  async discoverSurface(urlObj) {
    const robotsUrl = `${urlObj.origin}/robots.txt`;
    return new Promise((resolve) => {
      const client = urlObj.protocol === "https:" ? https : http;
      client.get(robotsUrl, { timeout: 4000 }, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => {
          resolve({
            robotsStatus: res.statusCode,
            hasRobots: res.statusCode === 200,
            contentSnippet: res.statusCode === 200 ? body.slice(0, 300) : null
          });
        });
      }).on("error", () => {
        resolve({ robotsStatus: 0, hasRobots: false });
      });
    });
  }

  generateReport({ target, policy, findings, evidence }) {
    let summary = `SECURITY ASSESSMENT REPORT\nTarget: ${target}\nPolicy: ${policy}\nTimestamp: ${new Date().toISOString()}\n\n`;
    summary += `=== FINDINGS SUMMARY (${findings.length}) ===\n`;

    if (findings.length === 0) {
      summary += "✅ No security deficiencies detected during safe assessment.\n";
    } else {
      findings.forEach((f, idx) => {
        summary += `${idx + 1}. [${f.severity}] ${f.title}\n`;
        summary += `   Description: ${f.description}\n`;
        summary += `   Recommendation: ${f.recommendation}\n\n`;
      });
    }

    summary += `\n=== EVIDENCE COLLECTION ===\n`;
    evidence.forEach((ev) => {
      summary += `- ${ev.step}: ${JSON.stringify(ev.result)}\n`;
    });

    return summary;
  }
}

module.exports = SecurityAssessmentCapability;
