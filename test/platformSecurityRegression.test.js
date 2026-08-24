const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.ARIA_PLATFORM_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-security-"));
process.env.PLATFORM_SESSION_SECRET = "platform-security-regression-secret";
process.env.ARIA_LIVE_PAYMENTS = "false";

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

function cookieOf(response) {
  return (response.headers.get("set-cookie") || "").split(";")[0];
}

async function register(base, email) {
  const response = await fetch(`${base}/api/platform/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "secure-pass-123", name: email.split("@")[0] }),
  });
  assert.equal(response.status, 201);
  const body = await response.json();
  return { body, cookie: cookieOf(response) };
}

async function post(base, route, cookie, csrf, body) {
  return fetch(`${base}${route}`, {
    method: "POST",
    headers: { Cookie: cookie, "x-csrf-token": csrf, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("platform security: payment mutations cannot cross tenant boundaries", async () => {
  const { base, server } = await boot();
  try {
    const a = await register(base, "tenant-a@example.com");
    const b = await register(base, "tenant-b@example.com");
    const checkout = await post(base, "/api/platform/billing/checkout", a.cookie, a.body.csrf, { planId: "starter", provider: "manual" });
    assert.equal(checkout.status, 200);
    const checkoutBody = await checkout.json();
    const intentId = checkoutBody.intent.id;

    const crossReconcile = await post(base, `/api/platform/billing/payment/${intentId}/reconcile`, b.cookie, b.body.csrf, { status: "succeeded" });
    assert.equal(crossReconcile.status, 404);
    const crossStatus = await post(base, `/api/platform/payments/${intentId}/status`, b.cookie, b.body.csrf, { status: "succeeded" });
    assert.equal(crossStatus.status, 404);

    const ownerReconcile = await post(base, `/api/platform/billing/payment/${intentId}/reconcile`, a.cookie, a.body.csrf, { status: "succeeded" });
    assert.equal(ownerReconcile.status, 200);
  } finally {
    server.close();
  }
});

test("platform security: repaired GET endpoints return JSON successfully", async () => {
  const { base, server } = await boot();
  try {
    const a = await register(base, "endpoint-owner@example.com");
    for (const route of ["/api/platform/integrations", "/api/platform/autopilot/recommendations"]) {
      const response = await fetch(`${base}${route}`, { headers: { Cookie: a.cookie } });
      assert.equal(response.status, 200, route);
      const body = await response.json();
      assert.equal(body.ok, true, route);
    }
  } finally {
    server.close();
  }
});

test("platform security: logout revokes the bearer cookie session", async () => {
  const { base, server } = await boot();
  try {
    const a = await register(base, "logout-owner@example.com");
    const logout = await fetch(`${base}/api/platform/auth/logout`, { method: "POST", headers: { Cookie: a.cookie } });
    assert.equal(logout.status, 200);
    const session = await fetch(`${base}/api/platform/auth/session`, { headers: { Cookie: a.cookie } });
    assert.equal(session.status, 401);
  } finally {
    server.close();
  }
});

test.after(() => {
  fs.rmSync(process.env.ARIA_PLATFORM_DATA_DIR, { recursive: true, force: true });
  delete process.env.ARIA_PLATFORM_DATA_DIR;
  delete process.env.PLATFORM_SESSION_SECRET;
  delete process.env.ARIA_LIVE_PAYMENTS;
});
