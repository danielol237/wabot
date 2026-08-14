// ARIA Learner Portal — auth flow integration tests (no external Google OAuth).
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

process.env.PORTAL_SESSION_SECRET = "test-portal-secret";
process.env.GOOGLE_CLIENT_ID = "";
process.env.GOOGLE_CLIENT_SECRET = "";
process.env.BASE_URL = "";

const STATE = path.join(__dirname, "../data/learnerAccounts.json");
const LINKS = path.join(__dirname, "../data/portalLinks.json");
function wipe() { for (const file of [STATE, LINKS]) { try { fs.rmSync(file, { force: true }); } catch (_) {} } }

function boot() {
  const app = express();
  app.use("/portal", require("../src/tools/learnerPortal").router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: "http://127.0.0.1:" + server.address().port + "/portal", server }));
  });
}

test("portal: login page renders CoreRipper-style signup", async () => {
  const { base, server } = await boot();
  try {
    const r = await fetch(base + "/login");
    const html = await r.text();
    assert.strictEqual(r.status, 200);
    assert.ok(html.includes("Create your account"));
    assert.ok(html.includes("Continue with Google"));
    assert.ok(html.includes("OR USE EMAIL"));
    assert.ok(html.includes("Start with email, then link your WhatsApp learning history."));
    assert.ok(html.includes("name-field"));
  } finally { server.close(); wipe(); }
});

test("portal: email signup sets session; unauthenticated / redirects to login", async () => {
  const { base, server } = await boot();
  try {
    // no cookie -> redirect to login
    const unauth = await fetch(base + "/", { redirect: "manual" });
    assert.strictEqual(unauth.status, 302);
    assert.ok(unauth.headers.get("location").includes("/portal/login"));
    // signup
    const signup = await fetch(base + "/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "Alex@x.com", password: "longenough123", name: "Alex", mode: "signup" }) });
    assert.strictEqual(signup.status, 200);
    const sc = signup.headers.get("set-cookie");
    assert.ok(sc && sc.includes("aria_portal="), "session cookie set");
    // authed home
    const authed = await fetch(base + "/", { headers: { Cookie: sc } });
    assert.strictEqual(authed.status, 200);
    const authedHtml = await authed.text();
    assert.ok(authedHtml.includes("Welcome, Alex."));
    assert.ok(authedHtml.includes("Connect your WhatsApp progress"));
    const login = await fetch(base + "/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "alex@x.com", password: "longenough123", mode: "login" }) });
    assert.strictEqual(login.status, 200);
    assert.ok(login.headers.get("set-cookie")?.includes("aria_portal="));
    const loginHome = await fetch(base + "/", { headers: { Cookie: login.headers.get("set-cookie") } });
    const loginHtml = await loginHome.text();
    const { issueCode } = require("../src/tools/portalLinking");
    const { code } = issueCode("15551234567@s.whatsapp.net");
    const csrf = (loginHtml.match(/name="_csrf" value="([^"]+)"/) || [])[1];
    assert.ok(csrf, "portal csrf token rendered");
    const linked = await fetch(base + "/link", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: login.headers.get("set-cookie") }, body: new URLSearchParams({ _csrf: csrf, code }) , redirect: "manual" });
    assert.strictEqual(linked.status, 302);
    assert.ok(linked.headers.get("location").includes("linked=1"));
    const linkedHome = await fetch(base + "/", { headers: { Cookie: login.headers.get("set-cookie") } });
    assert.ok((await linkedHome.text()).includes("WhatsApp progress connected"));
  } finally { server.close(); wipe(); }
});

test("portal: Google sign-in reports missing configuration", async () => {
  const { base, server } = await boot();
  try {
    const r = await fetch(base + "/auth/google", { redirect: "manual" });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.get("location").includes("google-not-configured"));
  } finally { server.close(); wipe(); }
});

test("portal: Google callback rejects invalid OAuth state", async () => {
  const { base, server } = await boot();
  try {
    const r = await fetch(base + "/auth/google/callback?code=untrusted-code&state=invalid", { redirect: "manual" });
    assert.strictEqual(r.status, 302);
    assert.ok(r.headers.get("location").includes("oauth-state-invalid"));
  } finally { server.close(); wipe(); }
});

test("portal: weak password rejected", async () => {
  const { base, server } = await boot();
  try {
    const r = await fetch(base + "/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@x.com", password: "short", mode: "signup" }) });
    assert.strictEqual(r.status, 400);
  } finally { server.close(); wipe(); }
});


const oauthHarness = path.join(__dirname, "fixtures", "learnerOAuthHarness.js");
function runOAuthHarness(mode) {
  const result = spawnSync(process.execPath, [oauthHarness, mode], { cwd: path.join(__dirname, ".."), encoding: "utf8", env: { ...process.env } });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test("portal: Google config derives the deployed callback URI and OAuth start includes OIDC protections", () => {
  const config = runOAuthHarness("config");
  assert.equal(config.redirectUri, "https://wabot-ytal.onrender.com/portal/auth/google/callback");
  assert.equal(config.configured, true);
  const start = runOAuthHarness("start");
  assert.equal(start.status, 302);
  assert.equal(start.redirectUri, config.redirectUri);
  assert.equal(start.scope, "openid email profile");
  assert.equal(start.hasNonce, true);
  assert.equal(start.secureCookie, true);
  assert.equal(start.cookiePath, "/");
});

test("portal: explicit Google redirect URI wins over the derived origin", () => {
  const config = runOAuthHarness("explicit");
  assert.equal(config.redirectUri, "https://custom.example/portal/auth/google/callback");
});

test("portal: Google rejects unverified identities and reuses an email account", () => {
  const rejected = runOAuthHarness("unverified");
  assert.equal(rejected.status, 302);
  assert.match(rejected.location, /google-identity-invalid/);

  const reused = runOAuthHarness("email-reuse");
  assert.equal(reused.status, 302);
  assert.equal(reused.location, "/portal");
  assert.equal(reused.accountCount, 1);
  assert.equal(reused.account.id, "em_existing");
  assert.equal(reused.account.email, "learner@example.com");
  assert.equal(reused.account.googleSub, "google-existing");
  assert.equal(reused.account.name, "Google Learner");
});
