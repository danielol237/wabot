// Dashboard tests — auth, session, CSRF, API authorization, telemetry.
// Boots the dashboard router on an isolated express app so we can hit the
// real routes. Requires DASHBOARD_PASSWORD to be set for the test run.
const test = require("node:test");
const assert = require("node:assert");
const path = require("path");
const fs = require("fs");

const DASHBOARD_PASSWORD = "test-password-123";
process.env.DASHBOARD_PASSWORD = DASHBOARD_PASSWORD;
process.env.DASHBOARD_CSRF_SECRET = "test-csrf-secret";

const express = require("express");
const dashboard = require("../src/dashboard");
const tel = require("../src/tools/dashboardTelemetry");

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/dashboard", dashboard);
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const srv = app.listen(0, () => resolve(srv));
  });
}
function close(srv) {
  return new Promise((r) => srv.close(r));
}
function req(srv, method, p, { headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const http = require("http");
    const port = srv.address().port;
    // If body is an object, JSON-encode it (callers pass a string for raw form).
    const data = body != null && typeof body === "object" ? JSON.stringify(body) : body;
    const h = { ...headers };
    if (data && typeof data !== "string") h["Content-Type"] = "application/json";
    const r = http.request({ host: "127.0.0.1", port, path: p, method, headers: h }, (res) => {
      let buf = "";
      res.on("data", (c) => (buf += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(buf); } catch (_) {}
        resolve({ status: res.statusCode, headers: res.headers, body: buf, json, setCookie: res.headers["set-cookie"] });
      });
    });
    if (data) r.write(data);
    r.end();
  });
}

// Login and return the session cookie (aria_session=...) plus CSRF-derived token.
async function login(srv) {
  const r = await req(srv, "POST", "/dashboard/login", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "password=" + DASHBOARD_PASSWORD,
  });
  // The router sets a cookie via res.cookie → Set-Cookie header.
  const setCookie = r.headers["set-cookie"] || r.headers["set-cookie"] || "";
  const cookie = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = String(cookie).match(/aria_session=([^;]+)/);
  assert.ok(match, "login should set aria_session cookie");
  return "aria_session=" + match[1];
}

test("dashboard: unauthenticated GET redirects to login", async () => {
  const srv = await listen(makeApp());
  const r = await req(srv, "GET", "/dashboard/");
  assert.strictEqual(r.status, 401, "no session → 401");
  assert.ok(r.body.includes("Login"), "should render login");
  await close(srv);
});

test("dashboard: login with correct password issues a session", async () => {
  const srv = await listen(makeApp());
  const cookie = await login(srv);
  assert.ok(cookie.includes("aria_session="), "session cookie issued");
  await close(srv);
});

test("dashboard: authenticated GET / renders the cockpit", async () => {
  const srv = await listen(makeApp());
  const cookie = await login(srv);
  const r = await req(srv, "GET", "/dashboard/", { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes("Command"), "should render Command pane");
  assert.ok(r.body.includes("Business OS"), "should render Business OS nav and pane");
  assert.ok(r.body.includes("Integrations"), "should render Integrations nav and pane");
  assert.ok(r.body.includes("ARIA PLATFORM SURFACE MAP"), "should render integration readiness content");
  assert.ok(r.body.includes("Revenue Engine"), "should render Revenue Engine content");
  assert.ok(r.body.includes("Brain"), "should render Brain nav");
  assert.ok(r.body.includes("pane-sources"), "should render Sources pane");
  assert.ok(r.body.includes(">Sources</span>"), "should render Sources nav item");
  await close(srv);
});

test("dashboard: /api/source-reputation requires auth + returns provider snapshot", async () => {
  const srv = await listen(makeApp());
  const anon = await req(srv, "GET", "/dashboard/api/source-reputation");
  assert.strictEqual(anon.status, 401, "unauthenticated → 401");
  const cookie = await login(srv);
  const r = await req(srv, "GET", "/dashboard/api/source-reputation", { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.ok(Array.isArray(r.json), "returns provider array");
  await close(srv);
});

test("dashboard: POST without CSRF is rejected (403)", async () => {
  const srv = await listen(makeApp());
  const cookie = await login(srv);
  const r = await req(srv, "POST", "/dashboard/api/anime/x/retry", { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 403, "missing CSRF token → 403");
  await close(srv);
});

test("dashboard: /api/live requires auth", async () => {
  const srv = await listen(makeApp());
  const anon = await req(srv, "GET", "/dashboard/api/live");
  assert.strictEqual(anon.status, 401, "unauthenticated /api/live → 401");
  await close(srv);
});

test("dashboard: /api/live returns telemetry for authenticated user", async () => {
  const srv = await listen(makeApp());
  const cookie = await login(srv);
  const r = await req(srv, "GET", "/dashboard/api/live", { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.json && typeof r.json.msgsPerMin === "number", "live status has msgsPerMin");
  assert.ok("online" in (r.json || {}), "live status has online flag");
  await close(srv);
});

test("telemetry: analytics windows + record round-trip", () => {
  // Capture baseline BEFORE recording. Telemetry accumulates across runs in the
  // shared data/dashboardTelemetry.json (not reset on boot), so asserting exact
  // counts against an absolute value is inherently flaky. We assert the DELTA.
  const before = tel.analytics()["24h"];
  tel.record("message");
  tel.record("command", { detail: "test" });
  tel.record("ai", { ok: true, latency: 150, provider: "cerebras" });
  const a = tel.analytics();
  assert.ok(a["24h"].messages >= before.messages + 1, "24h messages should count the recorded event");
  assert.ok(a["24h"].commands >= before.commands + 1, "24h commands should count");
  assert.ok(a["24h"].aiRequests >= before.aiRequests + 1, "24h AI requests should count");
  assert.ok((a["24h"].providers.cerebras || 0) >= (before.providers?.cerebras || 0) + 1, "provider split should count cerebras");
  // Cleanup telemetry file.
  try { fs.unlinkSync(path.join(__dirname, "../data/dashboardTelemetry.json")); } catch (_) {}
});

test("telemetry: brain metrics have calculable definitions", () => {
  const b = tel.brainData();
  // Every metric is { value, formula } with a defined 0-100 value (or null
  // when there's genuinely no data) and a human-readable formula string.
  for (const k of ["memory", "learning", "automation", "reliability"]) {
    assert.ok(b[k] && typeof b[k] === "object", `${k} should be a metric object`);
    const v = b[k].value;
    assert.ok(v === null || (typeof v === "number" && v >= 0 && v <= 100), `${k}.value must be 0-100 or null, got ${v}`);
    assert.ok(typeof b[k].formula === "string" && b[k].formula.length > 0, `${k} must have a formula`);
  }
  // Reliability is a rate (or null with no traffic) — never a fake number.
  if (b.reliability.value != null) assert.ok(b.reliability.value >= 0 && b.reliability.value <= 100);
  assert.ok(Array.isArray(b.recurringFailures), "recurring failures is a list");
});

test("dashboard: renders the WhatsApp phone-number pairing pane", async () => {
  const srv = await listen(makeApp());
  const cookie = await login(srv);
  const r = await req(srv, "GET", "/dashboard/?pane=pairing", { headers: { Cookie: cookie } });
  assert.strictEqual(r.status, 200);
  assert.ok(r.body.includes("Pair WhatsApp"), "pairing pane should be present");
  assert.ok(r.body.includes("pairing-number"), "phone-number input should be present");
  assert.ok(r.body.includes("Open QR pairing fallback"), "QR fallback should remain available");
  await close(srv);
});

test("dashboard: pairing status requires auth and code requests require CSRF", async () => {
  const srv = await listen(makeApp());
  const anon = await req(srv, "GET", "/dashboard/api/pairing");
  assert.strictEqual(anon.status, 401, "pairing status must be owner-authenticated");
  const cookie = await login(srv);
  const status = await req(srv, "GET", "/dashboard/api/pairing", { headers: { Cookie: cookie } });
  assert.strictEqual(status.status, 200);
  assert.equal(status.json.code, undefined, "status must not expose a code when none is active");
  const missingCsrf = await req(srv, "POST", "/dashboard/api/pairing/code", { headers: { Cookie: cookie, "Content-Type": "application/json" }, body: { phoneNumber: "+2348012345678" } });
  assert.strictEqual(missingCsrf.status, 403, "pairing mutation must require CSRF");
  const csrf = dashboard.csrfFor({ cookies: { aria_session: cookie.slice("aria_session=".length) } });
  const unavailable = await req(srv, "POST", "/dashboard/api/pairing/code", { headers: { Cookie: cookie, "Content-Type": "application/json" }, body: { _csrf: csrf, phoneNumber: "+2348012345678" } });
  assert.strictEqual(unavailable.status, 503, "request should report unavailable socket rather than crash");
  assert.doesNotMatch(unavailable.body, /2348012345678/);
  await close(srv);
});
