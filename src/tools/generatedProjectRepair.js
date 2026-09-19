const fs = require("fs");
const path = require("path");

const PROVIDER_FAILURE_RE = /AI request failed on all providers|user not found|cerebras\/gemini\/groq\/openrouter all tried/i;

function readText(projectDir, relativePath) {
  try { return fs.readFileSync(path.join(projectDir, relativePath), "utf8"); } catch (_) { return null; }
}

function hasProviderFailureText(content) {
  return typeof content === "string" && PROVIDER_FAILURE_RE.test(content.slice(0, 4000));
}

function normalizePackage(projectDir, files) {
  const relativePath = files.includes("package.json") ? "package.json" : null;
  if (!relativePath) return { fixes: [], changed: {} };
  const filePath = path.join(projectDir, relativePath);
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (_) { return { fixes: [], changed: {} }; }
  const sourceFiles = files.filter((file) => /\.(?:js|cjs|mjs|jsx|ts|tsx)$/.test(file));
  const source = sourceFiles.map((file) => readText(projectDir, file) || "").join("\n");
  const fixes = [];
  if (pkg.type === "module" && /\brequire\s*\(|\bmodule\.exports\b|__dirname\b/.test(source)) {
    delete pkg.type;
    fixes.push("removed package.json type=module because generated server/config files use CommonJS");
  }
  pkg.scripts = { ...(pkg.scripts || {}) };
  if (files.includes("server.js") && !pkg.scripts.start) {
    pkg.scripts.start = "node server.js";
    fixes.push("added npm start for server.js");
  }
  if (files.includes("vite.config.js")) {
    if (!pkg.scripts.dev) { pkg.scripts.dev = "vite"; fixes.push("added npm run dev for Vite"); }
    if (!pkg.scripts.build) { pkg.scripts.build = "vite build"; fixes.push("added npm run build for Vite"); }
  }
  if (!fixes.length) return { fixes, changed: {} };
  const content = JSON.stringify(pkg, null, 2) + "\n";
  fs.writeFileSync(filePath, content, "utf8");
  return { fixes, changed: { [relativePath]: content } };
}

function classNamesFromHtml(html) {
  return [...new Set([...String(html || "").matchAll(/class\s*=\s*["']([^"']+)["']/gi)]
    .flatMap((match) => match[1].split(/\s+/)).filter(Boolean))];
}

function cssSelectors(css) {
  return new Set([...String(css || "").matchAll(/\.([a-zA-Z][\w-]*)\s*(?:[,:{])/g)].map((match) => match[1]));
}

function repairFrontendContracts(projectDir, files) {
  const htmlFile = files.find((file) => /\.html?$/i.test(file));
  const cssFile = files.find((file) => /\.css$/i.test(file));
  const fixes = [];
  const changed = {};
  let html = htmlFile ? readText(projectDir, htmlFile) : null;
  let css = cssFile ? readText(projectDir, cssFile) : null;

  if (html && htmlFile && !/<meta\b[^>]+name\s*=\s*["']description["']/i.test(html)) {
    const title = (html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "This project").replace(/\s+/g, " ").trim();
    const description = `${title.slice(0, 120)} — a responsive, accessible web experience.`;
    const meta = `    <meta name="description" content="${description.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">\n`;
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/(<head\b[^>]*>)/i, `$1\n${meta}`);
    else html = `<meta name="description" content="${description}">\n${html}`;
    fs.writeFileSync(path.join(projectDir, htmlFile), html, "utf8");
    changed[htmlFile] = html;
    fixes.push(`added a useful meta description to ${htmlFile}`);
  }
  if (html && htmlFile && !/<meta\b[^>]+name\s*=\s*["']viewport["']/i.test(html)) {
    const meta = `    <meta name="viewport" content="width=device-width, initial-scale=1">\n`;
    if (/<head\b[^>]*>/i.test(html)) html = html.replace(/(<head\b[^>]*>)/i, `$1\n${meta}`);
    else html = `<meta name="viewport" content="width=device-width, initial-scale=1">\n${html}`;
    fs.writeFileSync(path.join(projectDir, htmlFile), html, "utf8");
    changed[htmlFile] = html;
    fixes.push(`added a responsive viewport meta tag to ${htmlFile}`);
  }

  if (html && css && cssFile) {
    const missing = classNamesFromHtml(html).filter((name) => !cssSelectors(css).has(name) && !/^(?:active|hidden|show|container|row|col|icon|nav|menu)$/i.test(name));
    if (missing.length) {
      const rules = missing.map((name) => {
        const display = /^(?:hero|section|footer|header|main|contact|projects?)/i.test(name) ? "display: block;" : "display: inline-block;";
        return `\n/* Generated contract repair: ${name} is used by the HTML. */\n.${name} { ${display} }\n`;
      }).join("");
      css += rules;
      fs.writeFileSync(path.join(projectDir, cssFile), css, "utf8");
      changed[cssFile] = css;
      fixes.push(`added missing CSS contracts for ${missing.slice(0, 8).join(", ")}`);
    }
  }
  return { fixes, changed };
}

function repairPlaceholderCopy(projectDir, files) {
  const replacements = [
    [/lorem ipsum/gi, "Designed for clarity and momentum."],
    [/your company/gi, "This project"],
    [/your brand/gi, "This project"],
    [/your logo/gi, "Project mark"],
    [/company name/gi, "Project Studio"],
    [/example\.com/gi, "your-site.example"],
    [/build something great/gi, "Make the next useful thing"],
    [/coming soon/gi, "Available now"],
    [/dummy text/gi, "Project details"],
    [/insert (?:text|copy) here/gi, "Project details"],
    [/replace (?:this|me)/gi, "Project details"],
  ];
  const changed = {};
  const fixes = [];
  for (const relativePath of files.filter((file) => /\.(?:html?|md)$/i.test(file))) {
    let content = readText(projectDir, relativePath);
    if (content === null) continue;
    const original = content;
    for (const [pattern, replacement] of replacements) content = content.replace(pattern, replacement);
    if (content !== original) {
      fs.writeFileSync(path.join(projectDir, relativePath), content, "utf8");
      changed[relativePath] = content;
      fixes.push(`replaced generic starter copy in ${relativePath}`);
    }
  }
  return { fixes, changed };
}

function inspectGeneratedArtifacts(projectDir, files) {
  const failures = [];
  for (const relativePath of files) {
    if (!/\.(?:css|html|js|cjs|mjs|jsx|ts|tsx|json)$/.test(relativePath)) continue;
    const content = readText(projectDir, relativePath);
    if (content !== null && hasProviderFailureText(content)) {
      failures.push({ file: relativePath, issue: "The file contains a raw AI-provider failure instead of generated source content." });
    }
  }
  return failures;
}

function repairGeneratedProject(projectDir, files) {
  const normalized = normalizePackage(projectDir, files);
  const frontend = repairFrontendContracts(projectDir, files);
  const copy = repairPlaceholderCopy(projectDir, files);
  const failures = inspectGeneratedArtifacts(projectDir, files);
  return {
    fixes: [...normalized.fixes, ...frontend.fixes, ...copy.fixes],
    changed: { ...normalized.changed, ...frontend.changed, ...copy.changed },
    failures,
  };
}

module.exports = { repairGeneratedProject, hasProviderFailureText, _test: { classNamesFromHtml, cssSelectors, repairFrontendContracts } };
