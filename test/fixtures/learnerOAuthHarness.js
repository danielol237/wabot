const Module = require("module");
const fs = require("fs");
const path = require("path");
const http = require("http");

const mode = process.argv[2] || "config";
const stateFile = path.join(__dirname, "../../data/learnerAccounts.json");
const originalLoad = Module._load;

if (mode === "unverified" || mode === "email-reuse") {
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "axios") {
      return {
        post: async () => ({ data: { access_token: "mock-access-token" } }),
        get: async () => ({ data: mode === "unverified"
          ? { id: "google-unverified", email: "unverified@example.com", verified_email: false, name: "Unverified" }
          : { id: "google-existing", email: "learner@example.com", verified_email: true, name: "Google Learner" } }),
      };
    }
    return originalLoad(request, parent, isMain);
  };
}

process.env.PORTAL_SESSION_SECRET = "test-portal-secret";
process.env.GOOGLE_CLIENT_ID = "test-client.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "test-client-secret";
process.env.BASE_URL = "https://wabot-ytal.onrender.com";
if (mode === "explicit") process.env.GOOGLE_REDIRECT_URI = "https://custom.example/portal/auth/google/callback";
else delete process.env.GOOGLE_REDIRECT_URI;

if (mode === "email-reuse") {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true });
  fs.writeFileSync(stateFile, JSON.stringify({
    em_existing: { id: "em_existing", name: "Email Learner", email: "learner@example.com", passwordHash: "x", createdAt: 1 },
  }));
}

const portal = require("../../src/tools/learnerPortal");

function runServer() {
  const app = require("express")();
  app.use("/portal", portal.router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve(server));
  });
}

async function main() {
  if (mode === "config" || mode === "explicit") {
    process.stdout.write(JSON.stringify(portal.getGoogleOAuthConfig()));
    return;
  }
  const server = await runServer();
  try {
    const port = server.address().port;
    const base = `http://127.0.0.1:${port}/portal`;
    const start = await fetch(`${base}/auth/google`, { redirect: "manual" });
    const location = new URL(start.headers.get("location"));
    const cookie = start.headers.get("set-cookie") || "";
    if (mode === "start") {
      process.stdout.write(JSON.stringify({ status: start.status, redirectUri: location.searchParams.get("redirect_uri"), scope: location.searchParams.get("scope"), hasNonce: Boolean(location.searchParams.get("nonce")), secureCookie: /\bSecure\b/i.test(cookie) }));
      return;
    }
    const callback = await fetch(`${base}/auth/google/callback?code=trusted-code&state=${encodeURIComponent(location.searchParams.get("state"))}`, { headers: { Cookie: cookie }, redirect: "manual" });
    if (mode === "unverified") {
      process.stdout.write(JSON.stringify({ status: callback.status, location: callback.headers.get("location") }));
      return;
    }
    const accounts = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    process.stdout.write(JSON.stringify({ status: callback.status, location: callback.headers.get("location"), accountCount: Object.keys(accounts).length, account: accounts.em_existing }));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    try { fs.rmSync(stateFile, { force: true }); } catch (_) {}
  }
}

main().catch((error) => {
  try { fs.rmSync(stateFile, { force: true }); } catch (_) {}
  process.stdout.write(JSON.stringify({ fatal: error.message }));
  process.exitCode = 1;
});
