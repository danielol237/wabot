const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const macaly = require("../src/tools/macalyCloud");

const { parseAction, parseSse, formatCatalog, firstJsonObject, MAX_STEPS } = macaly._test;
const GOOD = "good-token";

function startServer() {
  const seen = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    req.on("end", () => {
      seen.push({ headers: req.headers, body: raw ? JSON.parse(raw) : null });
      if (req.headers.authorization !== `Bearer ${GOOD}`) { res.writeHead(401).end("nope"); return; }
      const body = JSON.parse(raw);
      const json = (result) => {
        res.writeHead(200, { "Content-Type": "application/json", "Mcp-Session-Id": "sess-1" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
      };
      if (body.method === "initialize") return json({ protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "mock", version: "1" } });
      if (body.method === "notifications/initialized") { res.writeHead(202).end(); return; }
      if (body.method === "tools/list") {
        const payload = { jsonrpc: "2.0", id: body.id, result: { tools: [
          { name: "list_teams", description: "List workspaces", inputSchema: { type: "object", properties: {} }, annotations: { readOnlyHint: true } },
          { name: "publish_app", description: "Publish an app", inputSchema: { type: "object", properties: { appId: { type: "string" } }, required: ["appId"] }, annotations: { destructiveHint: true } },
        ] } };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.end(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
        return;
      }
      if (body.method === "tools/call") {
        if (body.params.name === "list_teams") return json({ content: [{ type: "text", text: "team-1 (Pro)" }] });
        return json({ isError: true, content: [{ type: "text", text: "boom" }] });
      }
      res.writeHead(404).end();
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({
    url: `http://127.0.0.1:${server.address().port}/mcp`,
    seen,
    close: () => new Promise((done) => server.close(done)),
  })));
}

function scripted(actions) {
  const queue = [...actions];
  return async () => (queue.length ? queue.shift() : JSON.stringify({ final: "done" }));
}

function recorder() {
  const replies = [];
  return { replies, reply: async (_sock, _msg, text) => { replies.push(text); } };
}

// Stand-in for macalyOAuth so these tests never touch the network for sign-in.
function fakeOauth({ linked = true, token = GOOD } = {}) {
  const oauth = {
    linked, token, unlinked: 0, links: 0,
    isLinked() { return this.linked; },
    async getAccessToken() { return this.linked ? this.token : null; },
    unlink() { this.linked = false; this.unlinked++; },
    async startLink({ notify, onLinked }) {
      this.links++;
      await notify("LINK https://example.test/activate CODE ABCD");
      this.linked = true;
      this.token = GOOD;
      await onLinked();
      return { success: true, pending: true };
    },
  };
  return oauth;
}

test("parseAction reads tool calls and final answers from noisy model output", () => {
  assert.deepStrictEqual(parseAction('Sure!\n```json\n{"tool":"list_teams","arguments":{"a":"}"}}\n```'), { tool: "list_teams", arguments: { a: "}" } });
  assert.deepStrictEqual(parseAction('{"final":"All done"}'), { final: "All done" });
  assert.deepStrictEqual(parseAction('{"tool":"x","arguments":[1]}'), { tool: "x", arguments: {} });
  assert.strictEqual(parseAction("no json here"), null);
  assert.strictEqual(parseAction('{"other":1}'), null);
  assert.deepStrictEqual(firstJsonObject('{"a":1} {"b":2}'), { a: 1 });
});

test("parseSse returns the message matching the request id", () => {
  const text = 'data: {"jsonrpc":"2.0","method":"ping"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.deepStrictEqual(parseSse(text, 7).result, { ok: true });
});

test("formatCatalog marks required params and safety hints", () => {
  const out = formatCatalog([
    { name: "publish_app", description: "Publish an app", inputSchema: { properties: { appId: { type: "string" } }, required: ["appId"] }, annotations: { destructiveHint: true } },
    { name: "list_teams", description: "List", inputSchema: {}, annotations: { readOnlyHint: true } },
  ]);
  assert.match(out, /publish_app\(appId\*:string\) \[destructive\]/);
  assert.match(out, /list_teams\(\) \[read-only\]/);
});

test("runs a natural-language request end to end over MCP", async () => {
  const server = await startServer();
  try {
    const client = new macaly.McpClient({ url: server.url, token: GOOD });
    const { replies, reply } = recorder();
    const outcome = await macaly.handleRequest(
      { request: "what workspaces do I have?", actorJid: "a@s", sock: {}, msg: {}, reply },
      { client, oauth: fakeOauth(), ask: scripted([JSON.stringify({ tool: "list_teams", arguments: {} }), JSON.stringify({ final: "You have team-1 (Pro)." })]) },
    );
    assert.strictEqual(outcome.ok, true);
    assert.strictEqual(replies.length, 2);
    assert.match(replies[1], /team-1/);
    const later = server.seen.filter((entry) => entry.body?.method === "tools/list" || entry.body?.method === "tools/call");
    assert.ok(later.every((entry) => entry.headers["mcp-session-id"] === "sess-1"));
    assert.ok(later.every((entry) => entry.headers["mcp-protocol-version"] === "2025-03-26"));
  } finally { await server.close(); }
});

test("unknown tools are reported back to the model instead of being called", async () => {
  const server = await startServer();
  try {
    const client = new macaly.McpClient({ url: server.url, token: GOOD });
    const prompts = [];
    const replies = [JSON.stringify({ tool: "made_up", arguments: {} }), JSON.stringify({ final: "ok" })];
    const outcome = await macaly.runRequest({ request: "do it" }, { client, oauth: fakeOauth(), ask: async (prompt) => { prompts.push(prompt); return replies.shift(); } });
    assert.strictEqual(outcome.message, "ok");
    assert.match(prompts[1], /There is no tool named "made_up"/);
    assert.strictEqual(server.seen.filter((entry) => entry.body?.method === "tools/call").length, 0);
  } finally { await server.close(); }
});

test("tool errors are fed back so the model can recover", async () => {
  const server = await startServer();
  try {
    const client = new macaly.McpClient({ url: server.url, token: GOOD });
    const prompts = [];
    const replies = [JSON.stringify({ tool: "publish_app", arguments: { appId: "a1" } }), JSON.stringify({ final: "Publishing failed." })];
    await macaly.runRequest({ request: "publish it" }, { client, oauth: fakeOauth(), ask: async (prompt) => { prompts.push(prompt); return replies.shift(); } });
    assert.match(prompts[1], /ERROR: boom/);
  } finally { await server.close(); }
});

test("stops after the step limit instead of looping forever", async () => {
  const server = await startServer();
  try {
    const client = new macaly.McpClient({ url: server.url, token: GOOD });
    const outcome = await macaly.runRequest({ request: "loop" }, { client, oauth: fakeOauth(), ask: async () => JSON.stringify({ tool: "list_teams", arguments: {} }) });
    assert.strictEqual(outcome.ok, false);
    assert.strictEqual(outcome.steps, MAX_STEPS);
    assert.match(outcome.message, /stopped after/);
  } finally { await server.close(); }
});

test("a person who has not linked Macaly gets a sign-in link, then their request runs", async () => {
  const server = await startServer();
  try {
    const oauth = fakeOauth({ linked: false });
    const { replies, reply } = recorder();
    const outcome = await macaly.handleRequest(
      { request: "show my apps", actorJid: "new-user@s", sock: {}, msg: {}, reply },
      { oauth, env: { MACALY_MCP_URL: server.url }, ask: scripted([JSON.stringify({ tool: "list_teams", arguments: {} }), JSON.stringify({ final: "You have team-1." })]) },
    );
    assert.strictEqual(oauth.links, 1);
    assert.match(replies[0], /isn't linked yet/);
    assert.match(replies[1], /LINK https:\/\/example.test\/activate/);
    assert.match(replies[replies.length - 1], /team-1/);
    assert.strictEqual(outcome.linking, true);
  } finally { await server.close(); }
});

test("an expired sign-in is cleared and the person is asked to link again", async () => {
  const server = await startServer();
  try {
    const oauth = fakeOauth({ linked: true, token: "stale" });
    const { replies, reply } = recorder();
    const outcome = await macaly.handleRequest(
      { request: "list my workspaces", actorJid: "stale-user@s", sock: {}, msg: {}, reply },
      { oauth, env: { MACALY_MCP_URL: server.url }, ask: scripted([JSON.stringify({ tool: "list_teams", arguments: {} }), JSON.stringify({ final: "Here you go: team-1." })]) },
    );
    assert.strictEqual(oauth.unlinked, 1);
    assert.strictEqual(oauth.links, 1);
    assert.ok(replies.some((text) => /signed me out/.test(text)));
    assert.match(replies[replies.length - 1], /team-1/);
    assert.strictEqual(outcome.linking, true);
  } finally { await server.close(); }
});

test("disconnecting is a tool the model chooses, not a command", async () => {
  const server = await startServer();
  try {
    const oauth = fakeOauth();
    const prompts = [];
    const replies = [JSON.stringify({ tool: "disconnect_account", arguments: {} }), JSON.stringify({ final: "Disconnected." })];
    const outcome = await macaly.handleRequest(
      { request: "sign me out of macaly", actorJid: "leaver@s", sock: {}, msg: {}, reply: async () => {} },
      { oauth, env: { MACALY_MCP_URL: server.url }, ask: async (prompt) => { prompts.push(prompt); return replies.shift(); } },
    );
    assert.match(prompts[0], /disconnect_account/);
    assert.strictEqual(oauth.unlinked, 1);
    assert.strictEqual(outcome.message, "Disconnected.");
  } finally { await server.close(); }
});
