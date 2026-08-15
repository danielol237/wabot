const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-web-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.PLATFORM_SESSION_SECRET = "platform-web-test-secret";
const auth = require("../src/core/identity/auth");
const router = require("../src/platformWeb");

function boot() {
  const app = express();
  app.use("/platform", router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
  });
}

test("platform web: public page presents the commercial workspace entry point", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/platform`);
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("Turn every serious conversation into momentum."));
    assert.ok(html.includes("Create workspace"));
    assert.ok(html.includes("Business operating system"));
    assert.ok(html.includes("aria-platform-theme"));
  } finally { server.close(); }
});

test("platform web: signed tenant session renders the workspace console", async () => {
  const session = auth.register({ email: "web-owner@example.com", password: "secure-pass-123", name: "Web Owner", tenantName: "Web Workspace" });
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/platform`, { headers: { Cookie: `aria_platform_session=${session.token}` } });
    const html = await response.text();
    assert.strictEqual(response.status, 200);
    assert.ok(html.includes("Revenue Engine"));
    assert.ok(html.includes("Web Workspace"));
    assert.ok(html.includes("Capacity & governance"));
  } finally { server.close(); }
});

test.after(() => {
  delete process.env.PLATFORM_SESSION_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
