const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
process.env.MACALY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "macaly-oauth-"));

const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const crypto = require("node:crypto");
const oauth = require("../src/tools/macalyOAuth");
const vault = require("../src/tools/macalyCredentialVault");

function startAuthServer({ device }) {
  const state = { registered: 0, deviceCalls: 0, challenge: null };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      const base = `http://127.0.0.1:${server.address().port}`;
      const send = (status, data, headers = {}) => { res.writeHead(status, { "Content-Type": "application/json", ...headers }); res.end(JSON.stringify(data)); };
      const url = new URL(req.url, base);
      const form = () => Object.fromEntries(new URLSearchParams(raw));
      if (req.method === "POST" && url.pathname === "/mcp") return send(401, { error: "unauthorized" }, { "WWW-Authenticate": `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"` });
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") return send(200, { resource: `${base}/mcp`, authorization_servers: [base] });
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return send(200, { issuer: base, authorization_endpoint: `${base}/authorize`, token_endpoint: `${base}/token`, registration_endpoint: `${base}/register`, ...(device ? { device_authorization_endpoint: `${base}/device` } : {}) });
      }
      if (url.pathname === "/register") { state.registered++; return send(201, { client_id: "cid-1" }); }
      if (url.pathname === "/device") return send(200, { device_code: "dev-1", user_code: "ABCD-1234", verification_uri: `${base}/activate`, expires_in: 600, interval: 1 });
      if (url.pathname === "/token") {
        const body = form();
        if (body.grant_type === "urn:ietf:params:oauth:grant-type:device_code") {
          state.deviceCalls++;
          if (state.deviceCalls < 2) return send(400, { error: "authorization_pending" });
          return send(200, { access_token: "at-device", refresh_token: "rt-1", expires_in: 3600, token_type: "Bearer" });
        }
        if (body.grant_type === "authorization_code") {
          const ok = body.code === "code-1" && crypto.createHash("sha256").update(body.code_verifier || "").digest("base64url") === state.challenge;
          return ok ? send(200, { access_token: "at-code", refresh_token: "rt-1", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
        }
        if (body.grant_type === "refresh_token") {
          return body.refresh_token === "rt-1" ? send(200, { access_token: "at-refreshed", expires_in: 3600 }) : send(400, { error: "invalid_grant" });
        }
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    base: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () => new Promise((done) => server.close(done)),
  })));
}

function collector() {
  const messages = [];
  return { messages, notify: async (text) => { messages.push(text); } };
}

function linked() {
  let done;
  const promise = new Promise((resolve) => { done = resolve; });
  return { promise, onLinked: async () => done() };
}

test("discovery follows the WWW-Authenticate hint to the sign-in endpoints", async () => {
  const server = await startAuthServer({ device: true });
  try {
    const found = await oauth._test.discover(`${server.base}/mcp`);
    assert.strictEqual(found.meta.token_endpoint, `${server.base}/token`);
    assert.strictEqual(found.resource, `${server.base}/mcp`);
  } finally { await server.close(); }
});

test("device flow sends a link and code, then stores the sign-in for that user only", async () => {
  const server = await startAuthServer({ device: true });
  try {
    const { messages, notify } = collector();
    const done = linked();
    const started = await oauth.startLink({ actorJid: "alice@s.whatsapp.net", notify, onLinked: done.onLinked }, { env: { MACALY_MCP_URL: `${server.base}/mcp` }, pollMs: 20 });
    assert.strictEqual(started.mode, "device");
    assert.match(messages[0], /ABCD-1234/);
    assert.match(messages[0], /\/activate/);
    await done.promise;
    assert.strictEqual(oauth.isLinked("alice@s.whatsapp.net"), true);
    assert.strictEqual(oauth.isLinked("bob@s.whatsapp.net"), false);
    assert.strictEqual(await oauth.getAccessToken("alice@s.whatsapp.net"), "at-device");
    assert.strictEqual(await oauth.getAccessToken("bob@s.whatsapp.net"), null);
    assert.match(messages[messages.length - 1], /linked to your WhatsApp account/);
    assert.ok(!fs.readFileSync(vault._test.storeFile(), "utf8").includes("at-device"), "token must be encrypted at rest");
  } finally { await server.close(); }
});

test("a second sign-in while one is waiting is refused, and the app registration is reused", async () => {
  const server = await startAuthServer({ device: true });
  try {
    const env = { MACALY_MCP_URL: `${server.base}/mcp` };
    const first = collector();
    const one = linked();
    await oauth.startLink({ actorJid: "carol@s", notify: first.notify, onLinked: one.onLinked }, { env, pollMs: 20 });
    const again = await oauth.startLink({ actorJid: "carol@s", notify: first.notify }, { env, pollMs: 20 });
    assert.strictEqual(again.success, false);
    assert.strictEqual(again.pending, true);
    await one.promise;
    const second = collector();
    const two = linked();
    server.state.deviceCalls = 0;
    await oauth.startLink({ actorJid: "dave@s", notify: second.notify, onLinked: two.onLinked }, { env, pollMs: 20 });
    await two.promise;
    assert.strictEqual(server.state.registered, 1, "two people, one app registration");
  } finally { await server.close(); }
});

test("expired access tokens are refreshed and the refresh token is kept", async () => {
  const server = await startAuthServer({ device: true });
  try {
    const { notify } = collector();
    const done = linked();
    await oauth.startLink({ actorJid: "erin@s", notify, onLinked: done.onLinked }, { env: { MACALY_MCP_URL: `${server.base}/mcp` }, pollMs: 20 });
    await done.promise;
    const credential = vault.getForUser("erin@s");
    vault.setForUser("erin@s", { ...credential, expires_at: Date.now() - 1000 });
    assert.strictEqual(await oauth.getAccessToken("erin@s"), "at-refreshed");
    assert.strictEqual(vault.getForUser("erin@s").refresh_token, "rt-1");
  } finally { await server.close(); }
});

test("a refresh token Macaly rejects signs the person out", async () => {
  const server = await startAuthServer({ device: true });
  try {
    const { notify } = collector();
    const done = linked();
    await oauth.startLink({ actorJid: "frank@s", notify, onLinked: done.onLinked }, { env: { MACALY_MCP_URL: `${server.base}/mcp` }, pollMs: 20 });
    await done.promise;
    vault.setForUser("frank@s", { ...vault.getForUser("frank@s"), refresh_token: "revoked", expires_at: Date.now() - 1000 });
    assert.strictEqual(await oauth.getAccessToken("frank@s"), null);
    assert.strictEqual(oauth.isLinked("frank@s"), false);
  } finally { await server.close(); }
});

test("without device codes, a sign-in link is sent and the callback completes the link", async () => {
  const server = await startAuthServer({ device: false });
  const probe = http.createServer();
  await new Promise((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const callbackPort = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  try {
    const env = {
      MACALY_MCP_URL: `${server.base}/mcp`,
      MACALY_OAUTH_REDIRECT_URI: `http://127.0.0.1:${callbackPort}/macaly/callback`,
      MACALY_CALLBACK_PORT: String(callbackPort),
      MACALY_CALLBACK_HOST: "127.0.0.1",
    };
    const { messages, notify } = collector();
    const done = linked();
    const started = await oauth.startLink({ actorJid: "gina@s", notify, onLinked: done.onLinked }, { env });
    assert.strictEqual(started.mode, "link");
    const authUrl = new URL(/Open: (\S+)/.exec(messages[0])[1]);
    assert.strictEqual(authUrl.searchParams.get("response_type"), "code");
    assert.strictEqual(authUrl.searchParams.get("code_challenge_method"), "S256");
    assert.strictEqual(authUrl.searchParams.get("redirect_uri"), env.MACALY_OAUTH_REDIRECT_URI);
    server.state.challenge = authUrl.searchParams.get("code_challenge");

    const bad = await fetch(`${env.MACALY_OAUTH_REDIRECT_URI}?code=code-1&state=wrong`);
    assert.strictEqual(bad.status, 400);
    assert.strictEqual(oauth.isLinked("gina@s"), false);

    const good = await fetch(`${env.MACALY_OAUTH_REDIRECT_URI}?code=code-1&state=${authUrl.searchParams.get("state")}`);
    assert.strictEqual(good.status, 200);
    await done.promise;
    assert.strictEqual(await oauth.getAccessToken("gina@s"), "at-code");
    const replay = await fetch(`${env.MACALY_OAUTH_REDIRECT_URI}?code=code-1&state=${authUrl.searchParams.get("state")}`);
    assert.strictEqual(replay.status, 400, "a link works once");
  } finally {
    await oauth._test.stopCallbackServer();
    await server.close();
  }
});

test("link sign-in explains what is missing when no redirect address is configured", async () => {
  const server = await startAuthServer({ device: false });
  try {
    const started = await oauth.startLink({ actorJid: "hank@s", notify: async () => {} }, { env: { MACALY_MCP_URL: `${server.base}/mcp` } });
    assert.strictEqual(started.success, false);
    assert.match(started.error, /MACALY_OAUTH_REDIRECT_URI/);
  } finally { await server.close(); }
});

test("unlinking removes the stored sign-in", async () => {
  vault.setForUser("ivy@s", { access_token: "x" });
  assert.strictEqual(oauth.isLinked("ivy@s"), true);
  oauth.unlink("ivy@s");
  assert.strictEqual(oauth.isLinked("ivy@s"), false);
});
