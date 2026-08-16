const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-companion-supabase-test-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.SUPABASE_PUBLISHABLE_KEY = "publishable-test-key";
process.env.COMPANION_SESSION_SECRET = "companion-session-test-secret-that-is-long-enough";
delete process.env.COMPANION_API_KEY;

let mockUserStatus = 200;
const mockSupabase = http.createServer((req, res) => {
  if (req.url === "/auth/v1/user") {
    res.statusCode = mockUserStatus;
    res.setHeader("Content-Type", "application/json");
    res.end(mockUserStatus === 200 ? JSON.stringify({ id: "supabase-user-1", email: "companion@example.com", user_metadata: { full_name: "Companion Tester" } }) : JSON.stringify({ message: "invalid token" }));
    return;
  }
  res.statusCode = 404;
  res.end();
});

const router = require("../src/companion");

function boot() {
  return new Promise((resolve) => {
    const start = () => {
      process.env.SUPABASE_URL = `http://127.0.0.1:${mockSupabase.address().port}`;
      const app = express();
      app.use(express.json());
      app.use("/api/companion", router);
      const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
    };
    if (mockSupabase.listening) start();
    else mockSupabase.listen(0, "127.0.0.1", start);
  });
}

test("companion Supabase exchange: verifies the access token and issues a device-bound ARIA session", async () => {
  mockUserStatus = 200;
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/companion/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid-supabase-access-token" },
      body: JSON.stringify({ deviceId: "android-test-device" }),
    });
    assert.strictEqual(response.status, 200);
    const body = await response.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.deviceId, "android-test-device");
    assert.match(body.token, /^[^.]+\.[^.]+$/);
    assert.strictEqual(body.user.email, "companion@example.com");
    assert.match(body.tenant.name, /ARIA Companion/);
  } finally {
    server.close();
  }
});

test("companion Supabase exchange: rejects an invalid Supabase access token", async () => {
  mockUserStatus = 401;
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/companion/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer expired-token" },
      body: JSON.stringify({ deviceId: "android-test-device-invalid" }),
    });
    assert.strictEqual(response.status, 401);
    const body = await response.json();
    assert.strictEqual(body.ok, false);
    assert.match(body.error, /invalid or expired/i);
  } finally {
    server.close();
  }
});

test("companion vision: requires auth and validates image MIME types", async () => {
  mockUserStatus = 200;
  const { base, server } = await boot();
  try {
    const unauthenticated = await fetch(`${base}/api/companion/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageBase64: "aGVsbG8=", mimeType: "image/jpeg" }),
    });
    assert.strictEqual(unauthenticated.status, 401);

    const sessionResponse = await fetch(`${base}/api/companion/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer valid-supabase-access-token" },
      body: JSON.stringify({ deviceId: "android-vision-device" }),
    });
    const session = await sessionResponse.json();
    const invalidMime = await fetch(`${base}/api/companion/vision`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.token}` },
      body: JSON.stringify({ imageBase64: "aGVsbG8=", mimeType: "text/plain" }),
    });
    assert.strictEqual(invalidMime.status, 400);
    const body = await invalidMime.json();
    assert.match(body.error, /mimeType/i);
  } finally {
    server.close();
  }
});

test("companion sessions: signed claims verify and tampered tokens fail", () => {
  const { issueCompanionSession, verifyCompanionSession } = require("../src/companionSupabase");
  const token = issueCompanionSession({ userId: "usr_test", tenantId: "tenant_test", supabaseSubject: "supabase-user-1", email: "companion@example.com" });
  const claims = verifyCompanionSession(token);
  assert.strictEqual(claims.sub, "usr_test");
  assert.strictEqual(claims.tid, "tenant_test");
  assert.strictEqual(verifyCompanionSession(`${token}tampered`), null);
});

test.after(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_PUBLISHABLE_KEY;
  delete process.env.COMPANION_SESSION_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
  mockSupabase.close();
});
