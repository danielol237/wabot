// ARIA Learner Portal — auth flow integration tests (no external Google OAuth).
const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const path = require("path");

process.env.PORTAL_SESSION_SECRET = "test-portal-secret";

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
    assert.ok(html.includes("learning space that remembers your progress"));
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

test("portal: weak password rejected", async () => {
  const { base, server } = await boot();
  try {
    const r = await fetch(base + "/auth/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "x@x.com", password: "short", mode: "signup" }) });
    assert.strictEqual(r.status, 400);
  } finally { server.close(); wipe(); }
});
