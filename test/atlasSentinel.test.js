const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const atlas = require("../src/tools/atlasStore");
const sentinel = require("../src/tools/atlasSentinel");
const webhooks = require("../src/tools/atlasWebhooks");

function cleanup(id) {
  try { fs.rmSync(path.join(atlas.ATLAS_DIR, id + ".json"), { force: true }); } catch (_) {}
}

function requestMock(headers, body) {
  const map = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    body,
    rawBody: Buffer.from(body),
    get(name) { return map[String(name).toLowerCase()] || ""; },
  };
}

test("Atlas Sentinel normalizes a failed GitHub check into evidence, risk, and a decision brief exactly once", () => {
  const owner = "atlas-v3-owner-" + Date.now();
  const workspace = atlas.createWorkspace(owner, { title: "Sentinel release", outcome: "Keep the release safe" });
  atlas.configureSentinel(owner, workspace.id, { enabled: true, sources: { github: { repository: "danielol237/wabot" } } });
  const payload = {
    action: "completed",
    check_run: { conclusion: "failure" },
    repository: { full_name: "danielol237/wabot" },
  };
  try {
    const first = sentinel.ingestGithub(owner, payload, "check_run", "delivery-v3-1");
    const second = sentinel.ingestGithub(owner, payload, "check_run", "delivery-v3-1");
    assert.equal(first.status, "accepted");
    assert.equal(first.signal.severity, "high");
    assert.ok(first.evidence.id);
    assert.ok(first.risk.id);
    assert.ok(first.brief.id);
    assert.equal(second.status, "duplicate");
    const stored = atlas.getWorkspace(owner, workspace.id);
    assert.equal(stored.signals.length, 1);
    assert.equal(stored.evidence.filter((item) => item.kind === "sentinel_signal").length, 1);
    assert.equal(stored.risks.length, 1);
    assert.equal(stored.briefs.length, 1);
    assert.equal(stored.signals[0].briefId, stored.briefs[0].id);
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas Sentinel owner controls acknowledge and resolve linked state without executing side effects", () => {
  const owner = "atlas-v3-owner-" + Date.now() + "-controls";
  const workspace = atlas.createWorkspace(owner, { title: "Sentinel controls", outcome: "Review operational signals" });
  atlas.configureSentinel(owner, workspace.id, { enabled: true, sources: { github: { repository: "danielol237/wabot" } } });
  try {
    const result = sentinel.ingestGithub(owner, { action: "completed", check_run: { conclusion: "failure" }, repository: { full_name: "danielol237/wabot" } }, "check_run", "delivery-v3-controls");
    const signalId = result.signal.id;
    const briefId = result.brief.id;
    const acknowledged = sentinel.handleSentinel(owner, `acknowledge signal ${signalId}`);
    assert.match(acknowledged.text, /Acknowledged/);
    assert.equal(atlas.getWorkspace(owner, workspace.id).signals[0].status, "acknowledged");
    const approved = sentinel.handleSentinel(owner, `approve brief ${briefId}`);
    assert.match(approved.text, /Approved/);
    assert.equal(atlas.getWorkspace(owner, workspace.id).briefs[0].status, "approved");
    const resolved = sentinel.handleSentinel(owner, `resolve signal ${signalId}`);
    assert.match(resolved.text, /Resolved/);
    const stored = atlas.getWorkspace(owner, workspace.id);
    assert.equal(stored.signals[0].status, "resolved");
    assert.equal(stored.risks[0].status, "closed");
    assert.equal(stored.briefs[0].status, "resolved");
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas Sentinel validates GitHub HMAC and Render signed timestamps", () => {
  const githubSecret = "github-sentinel-test-secret";
  const githubBody = JSON.stringify({ hello: "github" });
  const githubSignature = "sha256=" + crypto.createHmac("sha256", githubSecret).update(githubBody).digest("hex");
  const previousGithub = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.GITHUB_WEBHOOK_SECRET = githubSecret;
  try {
    const valid = webhooks._test.githubAuth(requestMock({ "x-hub-signature-256": githubSignature, "x-github-delivery": "delivery-auth", "user-agent": "GitHub-Hookshot/test" }, githubBody));
    const invalid = webhooks._test.githubAuth(requestMock({ "x-hub-signature-256": "sha256=bad", "x-github-delivery": "delivery-auth", "user-agent": "GitHub-Hookshot/test" }, githubBody));
    assert.equal(valid.valid, true);
    assert.equal(invalid.valid, false);
  } finally {
    if (previousGithub === undefined) delete process.env.GITHUB_WEBHOOK_SECRET; else process.env.GITHUB_WEBHOOK_SECRET = previousGithub;
  }

  const renderSecret = "render-sentinel-test-secret";
  const renderId = "evt-v3-auth";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const renderBody = JSON.stringify({ type: "deploy_ended", timestamp: new Date().toISOString(), data: { id: renderId, serviceId: "srv-v3" } });
  const signed = `${renderId}.${timestamp}.${renderBody}.${renderSecret}`;
  const renderSignature = "v1," + crypto.createHmac("sha256", renderSecret).update(signed).digest("base64");
  const previousRender = process.env.RENDER_WEBHOOK_SECRET;
  process.env.RENDER_WEBHOOK_SECRET = renderSecret;
  try {
    const valid = webhooks._test.renderAuth(requestMock({ "webhook-id": renderId, "webhook-timestamp": timestamp, "webhook-signature": renderSignature }, renderBody));
    assert.equal(valid.valid, true);
    const stale = webhooks._test.renderAuth(requestMock({ "webhook-id": renderId, "webhook-timestamp": String(Number(timestamp) - 600), "webhook-signature": renderSignature }, renderBody));
    assert.equal(stale.valid, false);
  } finally {
    if (previousRender === undefined) delete process.env.RENDER_WEBHOOK_SECRET; else process.env.RENDER_WEBHOOK_SECRET = previousRender;
  }
});

test("Atlas Sentinel webhook route accepts a verified GitHub delivery and deduplicates its event ID", async () => {
  const express = require("express");
  const http = require("node:http");
  const rawOwner = "atlas-v3-owner-" + Date.now() + "-http";
  const owner = rawOwner + "@s.whatsapp.net";
  const workspace = atlas.createWorkspace(owner, { title: "Webhook route project", outcome: "Receive verified delivery signals" });
  atlas.configureSentinel(owner, workspace.id, { enabled: true, sources: { github: { repository: "danielol237/wabot" } } });
  const previousOwner = process.env.OWNER_NUMBER;
  const previousSecret = process.env.GITHUB_WEBHOOK_SECRET;
  process.env.OWNER_NUMBER = rawOwner;
  process.env.GITHUB_WEBHOOK_SECRET = "route-github-secret";
  const app = express();
  app.use(express.json({ limit: "256kb", verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use("/webhooks/atlas", webhooks);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const payload = { action: "completed", check_run: { conclusion: "failure" }, repository: { full_name: "danielol237/wabot" } };
  const body = JSON.stringify(payload);
  const signature = "sha256=" + crypto.createHmac("sha256", process.env.GITHUB_WEBHOOK_SECRET).update(body).digest("hex");
  function post() {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: server.address().port, path: "/webhooks/atlas/github", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), "User-Agent": "GitHub-Hookshot/test", "X-GitHub-Event": "check_run", "X-GitHub-Delivery": "route-delivery-1", "X-Hub-Signature-256": signature } }, (res) => {
        let text = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => { text += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, body: JSON.parse(text) }));
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }
  try {
    const first = await post();
    const second = await post();
    assert.equal(first.status, 202);
    assert.equal(second.status, 202);
    assert.equal(first.body.status, "accepted");
    assert.equal(second.body.status, "duplicate");
    assert.equal(atlas.getWorkspace(owner, workspace.id).signals.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    if (previousOwner === undefined) delete process.env.OWNER_NUMBER; else process.env.OWNER_NUMBER = previousOwner;
    if (previousSecret === undefined) delete process.env.GITHUB_WEBHOOK_SECRET; else process.env.GITHUB_WEBHOOK_SECRET = previousSecret;
    cleanup(workspace.id);
  }
});

test("Atlas Sentinel maps a failed Render deployment to a critical release signal", () => {
  const owner = "atlas-v3-owner-" + Date.now() + "-render";
  const workspace = atlas.createWorkspace(owner, { title: "Render release", outcome: "Keep deployment healthy" });
  atlas.configureSentinel(owner, workspace.id, { enabled: true, sources: { render: { serviceId: "srv-v3" } } });
  try {
    const result = sentinel.ingestRender(owner, { type: "deploy_ended", timestamp: new Date().toISOString(), data: { id: "evt-render-v3", serviceId: "srv-v3", serviceName: "aria", status: "failed" } });
    assert.equal(result.status, "accepted");
    assert.equal(result.signal.severity, "critical");
    assert.match(result.signal.title, /Render deployment failed/);
    assert.equal(atlas.getWorkspace(owner, workspace.id).briefs[0].actionLevel, "propose");
  } finally {
    cleanup(workspace.id);
  }
});

test("Atlas Sentinel explains enabled-but-quiet local monitoring in plain language", () => {
  const owner = "atlas-v3-owner-" + Date.now() + "-quiet";
  const workspace = atlas.createWorkspace(owner, { title: "Quiet monitoring", outcome: "Watch the project without noise" });
  atlas.configureSentinel(owner, workspace.id, { enabled: true });
  try {
    const result = sentinel.handleSentinel(owner, "show Sentinel");
    assert.match(result.text, /enabled and watching/);
    assert.match(result.text, /monitor, not a second chatbot/);
    assert.match(result.text, /stalled Atlas missions/);
    assert.match(result.text, /No tracked issue has been recorded/);
  } finally {
    cleanup(workspace.id);
  }
});
