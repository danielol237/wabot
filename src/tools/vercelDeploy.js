// ── Vercel static deploy (optional) ─────────────────────────
// Deploys a built static project to Vercel for a live preview URL.
// Requires VERCEL_TOKEN in env. If not configured/available, returns
// success:false so the build continues without a preview (never blocks).

const axios = require("axios");

const VERCEL_API = "https://api.vercel.com";

async function deployToVercel(projectDir, projectName) {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return { success: false, error: "VERCEL_TOKEN not set" };
  const { log, error } = require("../utils/logger");

  try {
    // Create a deployment. Vercel accepts a tarball or a set of files; for a
    // small static build we upload a simple file list.
    const files = [];
    const fs = require("fs");
    const path = require("path");
    function walk(dir, base) {
      for (const f of fs.readdirSync(dir)) {
        const fp = path.join(dir, f);
        if (f === "node_modules") continue;
        if (fs.statSync(fp).isDirectory()) { walk(fp, path.join(base, f)); continue; }
        const rel = path.posix.join(base, f);
        files.push({ file: rel, data: fs.readFileSync(fp, "base64"), encoding: "base64" });
      }
    }
    walk(projectDir, "");

    const res = await axios.post(`${VERCEL_API}/v13/deployments`, {
      name: (projectName || "aria-project").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 40),
      files,
      projectSettings: { framework: null },
      target: "production",
    }, {
      headers: { Authorization: `Bearer ${token}` },
      timeout: 30000,
    });

    const url = res.data?.url;
    if (url) return { success: true, url: "https://" + url };
    return { success: false, error: "No deployment URL returned" };
  } catch (err) {
    log("Vercel deploy failed (non-fatal):", err.message);
    return { success: false, error: err.message };
  }
}

module.exports = { deployToVercel };
