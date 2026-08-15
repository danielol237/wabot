const test = require("node:test");
const assert = require("node:assert");
const express = require("express");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-companion-test-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
const previous = process.env.COMPANION_API_KEY;
delete process.env.COMPANION_API_KEY;
const router = require("../src/companion");

function boot() {
  const app = express();
  app.use(express.json());
  app.use("/api/companion", router);
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ base: `http://127.0.0.1:${server.address().port}`, server }));
  });
}

test("companion: chat is disabled until an explicit API key is configured", async () => {
  const { base, server } = await boot();
  try {
    const response = await fetch(`${base}/api/companion/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: "hello" }) });
    assert.strictEqual(response.status, 503);
    const body = await response.json();
    assert.strictEqual(body.ok, false);
    assert.match(body.error, /not configured/i);
  } finally {
    server.close();
  }
});

test.after(() => {
  if (previous === undefined) delete process.env.COMPANION_API_KEY;
  else process.env.COMPANION_API_KEY = previous;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
