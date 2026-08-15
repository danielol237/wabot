const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DASHBOARD_PASSWORD = "platform-dashboard-password";
process.env.DASHBOARD_CSRF_SECRET = "platform-csrf-secret";
process.env.OWNER_NUMBER = "237650284057";
process.env.ARIA_PLATFORM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-router-"));
const router = require("../src/platformRouter");

function boot() {
  const app = express();
  app.use(express.json());
  app.use("/api/platform", router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
  });
}

test("platform router: authenticated owner can read the workspace overview", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/platform/overview`, { headers: { Authorization: `Bearer ${process.env.DASHBOARD_PASSWORD}` } });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.tenant.name, "ARIA Workspace");
    assert.ok(body.business);
    assert.ok(Array.isArray(body.payments));
    assert.ok(Array.isArray(body.integrations));
    assert.ok(body.integrations.some((item) => item.id === "anime-media"));
  } finally {
    server.close();
  }
});

test("platform router: mutations reject missing CSRF", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/platform/customers`, { method: "POST", headers: { Authorization: `Bearer ${process.env.DASHBOARD_PASSWORD}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Blocked" }) });
    assert.strictEqual(response.status, 403);
    const body = await response.json();
    assert.equal(body.ok, false);
  } finally {
    server.close();
  }
});

test("platform router: unauthenticated overview keeps an API JSON contract", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/platform/overview`, { headers: { Accept: "application/json" } });
    assert.strictEqual(response.status, 401);
    assert.equal(response.headers.get("content-type")?.includes("application/json"), true);
    const body = await response.json();
    assert.match(String(body.error || ""), /unauthorized|authentication|sign-in|session expired/i);
  } finally {
    server.close();
  }
});
