const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile, execFileSync } = require("child_process");

const CONTENT_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function createStaticServer(root) {
  const rootPath = path.resolve(root);
  const server = http.createServer((req, res) => {
    try {
      const requested = decodeURIComponent(String(req.url || "/").split("?")[0]);
      const relative = requested === "/" ? "index.html" : requested.replace(/^\/+/, "");
      const full = path.resolve(rootPath, relative);
      if (!full.startsWith(rootPath + path.sep) && full !== rootPath) return res.writeHead(403).end("Forbidden");
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) return res.writeHead(403).end("Forbidden");
      const target = stat.isDirectory() ? path.join(full, "index.html") : full;
      const targetStat = fs.lstatSync(target);
      if (targetStat.isSymbolicLink()) return res.writeHead(403).end("Forbidden");
      const data = fs.readFileSync(target);
      res.writeHead(200, { "Content-Type": CONTENT_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" });
      res.end(data);
    } catch (_) { res.writeHead(404).end("Not found"); }
  });
  return server;
}

function browserPath() {
  if (process.env.ARIA_CHROMIUM_PATH) return process.env.ARIA_CHROMIUM_PATH;
  for (const candidate of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    try {
      const resolved = execFileSync("sh", ["-lc", `command -v ${candidate}`], { encoding: "utf8", timeout: 2000 }).trim();
      if (resolved) return resolved;
    } catch (_) {}
  }
  return null;
}

function visibleText(html) {
  return String(html || "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function inspectDocument(dom, mode, url = null) {
  const html = String(dom || "");
  if (!/<body\b[\s\S]*<\/body>/i.test(html)) return { success: false, error: `${mode} smoke returned no document body`, output: html.slice(-6000) };
  const text = visibleText(html);
  if (text.length < 20) return { success: false, error: `${mode} smoke rendered less than 20 characters of visible text`, output: html.slice(-6000) };
  if (/lorem ipsum|your company|build something great|AI request failed on all providers/i.test(text)) return { success: false, error: `${mode} smoke detected placeholder or provider-failure copy`, output: text.slice(0, 1000) };
  return {
    success: true,
    ...(url ? { url } : {}),
    title: (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [null, ""])[1].trim(),
    textLength: text.length,
  };
}

function runStaticSmoke(root, warning) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const result = inspectDocument(html, "Static");
  if (!result.success) return result;
  return { ...result, skipped: true, warning };
}

function runBrowserSmoke(projectDir, options = {}) {
  const root = fs.existsSync(path.join(projectDir, "dist", "index.html")) ? path.join(projectDir, "dist") : projectDir;
  if (!fs.existsSync(path.join(root, "index.html"))) return Promise.resolve({ success: false, error: "Browser smoke test requires index.html or dist/index.html" });
  const executable = browserPath();
  if (!executable) return Promise.resolve(runStaticSmoke(root, "Chromium is unavailable; static HTML smoke validation was used."));
  const server = createStaticServer(root);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; server.close(); resolve(result); };
    server.on("error", (error) => finish({ success: false, error: `Browser smoke server failed: ${error.message}` }));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/`;
      execFile(executable, [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--hide-scrollbars", "--virtual-time-budget=5000", "--dump-dom", url,
      ], { timeout: options.timeoutMs || 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          if (error.code === "ENOENT") return finish(runStaticSmoke(root, "Chromium became unavailable; static HTML smoke validation was used."));
          return finish({ success: false, error: `Browser smoke failed: ${error.message}`, output: String(stderr || stdout || "").slice(-6000) });
        }
        const browserResult = inspectDocument(stdout, "Browser", url);
        if (!browserResult.success && /no document body/i.test(browserResult.error || "")) {
          return finish(runStaticSmoke(root, "Headless Chromium returned no document body; static HTML smoke validation was used."));
        }
        finish(browserResult);
      });
    });
  });
}

module.exports = { runBrowserSmoke, createStaticServer, _test: { browserPath, visibleText, inspectDocument, runStaticSmoke } };
