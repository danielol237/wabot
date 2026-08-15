const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-auth-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.PLATFORM_SESSION_SECRET = "platform-session-test-secret";
process.env.DASHBOARD_PASSWORD = "legacy-dashboard-password";
process.env.DASHBOARD_CSRF_SECRET = "legacy-dashboard-csrf";
const authRouter = require("../src/platformAuthRouter");
const platformRouter = require("../src/platformRouter");

function boot() {
  const app = express();
  app.use(express.json());
  app.use("/api/platform", authRouter);
  app.use("/api/platform", platformRouter);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
  });
}
function cookieOf(response) { return (response.headers.get("set-cookie") || "").split(";")[0]; }

test("platform auth: registration creates a tenant session and CSRF-protected business access", async () => {
  const { base, server } = await boot();
  try {
    const registration = await fetch(`${base}/api/platform/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "owner@example.com", password: "secure-pass-123", name: "Owner", tenantName: "Owner Workspace" }) });
    assert.strictEqual(registration.status, 201);
    const registered = await registration.json();
    assert.equal(registered.ok, true);
    assert.equal(registered.tenant.name, "Owner Workspace");
    assert.ok(registered.csrf);
    const cookie = cookieOf(registration);
    assert.match(cookie, /aria_platform_session=/);

    const session = await fetch(`${base}/api/platform/auth/session`, { headers: { Cookie: cookie } });
    assert.strictEqual(session.status, 200);
    const sessionJson = await session.json();
    assert.equal(sessionJson.context.role, "owner");

    const mutation = await fetch(`${base}/api/platform/customers`, { method: "POST", headers: { Cookie: cookie, "x-csrf-token": registered.csrf, "Content-Type": "application/json" }, body: JSON.stringify({ name: "Customer One", email: "customer@example.com" }) });
    assert.strictEqual(mutation.status, 200);
    const mutationJson = await mutation.json();
    assert.equal(mutationJson.customer.name, "Customer One");
  } finally { server.close(); }
});

test("platform auth: invalid credentials do not create a session", async () => {
  const { base, server } = await boot();
  try {
    const registration = await fetch(`${base}/api/platform/auth/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "another@example.com", password: "secure-pass-123", name: "Another" }) });
    assert.strictEqual(registration.status, 201);
    const login = await fetch(`${base}/api/platform/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "another@example.com", password: "wrong-pass" }) });
    assert.strictEqual(login.status, 401);
    assert.equal((await login.json()).ok, false);
  } finally { server.close(); }
});

test.after(() => {
  delete process.env.PLATFORM_SESSION_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
