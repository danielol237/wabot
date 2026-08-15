const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-payment-webhooks-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.MTN_WEBHOOK_SECRET = "mtn-webhook-test-secret";
const router = require("../src/paymentWebhooks");

function boot() {
  const app = express();
  app.use(express.json({ verify: (req, res, buf) => { req.rawBody = Buffer.from(buf); } }));
  app.use("/webhooks/payments", router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
  });
}

function signature(body) {
  return crypto.createHmac("sha256", process.env.MTN_WEBHOOK_SECRET).update(body).digest("hex");
}

test("payment webhook: invalid signatures are rejected", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/webhooks/payments/mtn`, { method: "POST", headers: { "Content-Type": "application/json", "x-signature": "bad" }, body: JSON.stringify({ eventId: "evt-bad" }) });
    assert.strictEqual(response.status, 401);
  } finally { server.close(); }
});

test("payment webhook: verified events are accepted once and duplicates are idempotent", async () => {
  const { base, server } = await boot();
  try {
    const body = JSON.stringify({ eventId: "evt-1", tenantId: "ten_test", status: "pending" });
    const headers = { "Content-Type": "application/json", "x-signature": signature(body) };
    const first = await fetch(`${base}/webhooks/payments/mtn`, { method: "POST", headers, body });
    const firstJson = await first.json();
    assert.strictEqual(first.status, 200);
    assert.equal(firstJson.duplicate, false);
    const second = await fetch(`${base}/webhooks/payments/mtn`, { method: "POST", headers, body });
    const secondJson = await second.json();
    assert.strictEqual(second.status, 200);
    assert.equal(secondJson.duplicate, true);
  } finally { server.close(); }
});

test.after(() => {
  delete process.env.MTN_WEBHOOK_SECRET;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
