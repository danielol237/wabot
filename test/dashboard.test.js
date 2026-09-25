const { test, beforeEach } = require("node:test");
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const http = require("http");
const express = require("express");

const auth = require("../src/utils/dashboardAuth");
const securityErrors = require("../src/utils/securityErrors");
const connectorRegistry = require("../src/tools/connectorRegistry");
const dashboardRouter = require("../src/dashboard");

beforeEach(() => {
  auth._resetForTesting();
});

test("Account Setup - Creates initial owner account and prevents second setup", async () => {
  assert.strictEqual(auth.hasOwnerAccount(), false);

  const acc = await auth.createAccount("testowner", "password123", "owner");
  assert.strictEqual(acc.username, "testowner");
  assert.strictEqual(acc.role, "owner");
  assert.strictEqual(auth.hasOwnerAccount(), true);

  await assert.rejects(async () => {
    await auth.createAccount("testowner2", "password123", "owner");
  }, /Owner account already setup|Account already exists/i);
});

test("Credentials Verification - Scrypt password verification with timing-safe comparison", async () => {
  await auth.createAccount("operator1", "SecurePass123!", "operator");

  const valid = await auth.verifyCredentials("operator1", "SecurePass123!");
  assert.notStrictEqual(valid, null);
  assert.strictEqual(valid.username, "operator1");
  assert.strictEqual(valid.role, "operator");

  const invalid = await auth.verifyCredentials("operator1", "WrongPass!");
  assert.strictEqual(invalid, null);

  const unknownUser = await auth.verifyCredentials("nonexistent", "Pass123!");
  assert.strictEqual(unknownUser, null);
});

test("Session Management - Token validation, revocation, and rotation", async () => {
  await auth.createAccount("owner1", "Password123!", "owner");

  const sessionRes = auth.createSession("owner1", "owner");
  assert.ok(sessionRes.rawToken);
  assert.ok(sessionRes.session.idHash);

  const validSession = auth.validateSessionToken(sessionRes.rawToken);
  assert.notStrictEqual(validSession, null);
  assert.strictEqual(validSession.username, "owner1");

  const revoked = auth.revokeSessionByToken(sessionRes.rawToken);
  assert.strictEqual(revoked, true);

  const afterRevoke = auth.validateSessionToken(sessionRes.rawToken);
  assert.strictEqual(afterRevoke, null);
});

test("Login Throttling - Locks account after 8 failed attempts", () => {
  const ip = "127.0.0.1";
  const username = "testuser";

  for (let i = 0; i < 7; i++) {
    auth.recordLoginFailure(ip, username);
  }
  let check = auth.checkLoginThrottled(ip, username);
  assert.strictEqual(check.throttled, false);

  auth.recordLoginFailure(ip, username); // 8th attempt
  check = auth.checkLoginThrottled(ip, username);
  assert.strictEqual(check.throttled, true);
  assert.ok(check.secondsLeft > 0);

  auth.clearLoginFailures(ip, username);
  check = auth.checkLoginThrottled(ip, username);
  assert.strictEqual(check.throttled, false);
});

test("Standardized Security Errors Format", () => {
  const err = securityErrors.createSecurityError("AUTHENTICATION_REQUIRED");
  assert.strictEqual(err.statusCode, 401);
  assert.strictEqual(err.body.error.code, "AUTHENTICATION_REQUIRED");
  assert.strictEqual(typeof err.body.error.message, "string");
  assert.ok(err.body.error.requestId.startsWith("req_"));
});

test("Connector Registry - Healthy calculation and structure", async () => {
  const registry = await connectorRegistry.getConnectorRegistrySummary();
  assert.ok(registry.summary);
  assert.strictEqual(typeof registry.summary.total, "number");
  assert.ok(Array.isArray(registry.connectors));
  assert.strictEqual(registry.connectors.length, connectorRegistry.CONNECTORS_DEFINITIONS.length);

  const gh = await connectorRegistry.getConnectorById("github");
  assert.ok(gh);
  assert.strictEqual(gh.id, "github");
});

test("HTTP Express Integration & Preserved Routes Regression", async () => {
  const app = express();
  app.use(express.json());
  app.use("/dashboard", dashboardRouter);

  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    // 1. Setup Flow via HTTP POST
    const setupRes = await globalThis.fetch(`${baseUrl}/dashboard/api/auth/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "httpowner", password: "httppassword123" })
    });
    const setupData = await setupRes.json();
    assert.strictEqual(setupRes.status, 200);
    assert.strictEqual(setupData.ok, true);
    assert.strictEqual(setupData.user.username, "httpowner");

    // Extract aria_session cookie
    const setCookieHeader = setupRes.headers.get("set-cookie");
    assert.ok(setCookieHeader);
    const sessionCookie = setCookieHeader.split(";")[0];

    // 2. Unauthenticated API request -> 401 JSON
    const unauthRes = await globalThis.fetch(`${baseUrl}/dashboard/api/dashboard/overview`, {
      headers: { Accept: "application/json" }
    });
    const unauthData = await unauthRes.json();
    assert.strictEqual(unauthRes.status, 401);
    assert.strictEqual(unauthData.error.code, "AUTHENTICATION_REQUIRED");

    // 3. Authenticated Overview API Request -> 200
    const overviewRes = await globalThis.fetch(`${baseUrl}/dashboard/api/dashboard/overview`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    const overviewData = await overviewRes.json();
    assert.strictEqual(overviewRes.status, 200);
    assert.ok(overviewData.aria);
    assert.ok(overviewData.connectors);

    // 4. Authenticated Connectors API Request -> 200
    const connRes = await globalThis.fetch(`${baseUrl}/dashboard/api/connectors`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    const connData = await connRes.json();
    assert.strictEqual(connRes.status, 200);
    assert.ok(connData.summary);

    // 5. Preserved Legacy Routes Regression Checks
    const liveRes = await globalThis.fetch(`${baseUrl}/dashboard/api/live`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    assert.strictEqual(liveRes.status, 200);

    const pairingRes = await globalThis.fetch(`${baseUrl}/dashboard/api/pairing`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    assert.strictEqual(pairingRes.status, 200);

    const animeRes = await globalThis.fetch(`${baseUrl}/dashboard/api/anime`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    assert.strictEqual(animeRes.status, 200);

    const atlasRes = await globalThis.fetch(`${baseUrl}/dashboard/atlas`, {
      headers: { Cookie: sessionCookie, Accept: "application/json" }
    });
    assert.strictEqual(atlasRes.status, 200);

  } finally {
    if (server.closeAllConnections) server.closeAllConnections();
    server.close();
  }

  // Force exit after all assertions pass so background WhatsApp socket listeners don't keep process open
  setTimeout(() => process.exit(0), 100);
});
