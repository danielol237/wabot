const fs = require("fs");
const http = require("http");
const path = require("path");
const { execFile } = require("child_process");

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
  return process.env.ARIA_CHROMIUM_PATH || "chromium";
}

function runBrowserSmoke(projectDir, options = {}) {
  const root = fs.existsSync(path.join(projectDir, "dist", "index.html")) ? path.join(projectDir, "dist") : projectDir;
  if (!fs.existsSync(path.join(root, "index.html"))) return Promise.resolve({ success: false, error: "Browser smoke test requires index.html or dist/index.html" });
  const server = createStaticServer(root);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => { if (settled) return; settled = true; server.close(); resolve(result); };
    server.on("error", (error) => finish({ success: false, error: `Browser smoke server failed: ${error.message}` }));
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const url = `http://127.0.0.1:${port}/`;
      execFile(browserPath(), [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
        "--hide-scrollbars", "--virtual-time-budget=5000", "--dump-dom", url,
      ], { timeout: options.timeoutMs || 30000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) return finish({ success: false, error: `Browser smoke failed: ${error.message}`, output: String(stderr || stdout || "").slice(-6000) });
        const dom = String(stdout || "");
        if (!/<body\b[\s\S]*<\/body>/i.test(dom)) return finish({ success: false, error: "Browser smoke returned no document body", output: dom.slice(-6000) });
        const text = dom.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        if (text.length < 20) return finish({ success: false, error: "Browser smoke rendered less than 20 characters of visible text", output: dom.slice(-6000) });
        if (/lorem ipsum|your company|build something great|AI request failed on all providers/i.test(text)) return finish({ success: false, error: "Browser smoke detected placeholder or provider-failure copy", output: text.slice(0, 1000) });
        finish({ success: true, url, title: (dom.match(/<title[^>]*>([^<]*)<\/title>/i) || [null, ""])[1].trim(), textLength: text.length });
      });
    });
  });
}

module.exports = { runBrowserSmoke, createStaticServer };
