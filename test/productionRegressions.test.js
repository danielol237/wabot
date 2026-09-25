const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/utils/commandRouter");
const providerHealth = require("../src/tools/providerHealth");
const minimax = require("../src/tools/minimax");
const whatsappDecryption = require("../src/utils/whatsappDecryptionHandler");
const ResultFormatter = require("../src/coding/reporting/ResultFormatter");

test("Regression: 'Aria set dashboard password as daniel' routes to dashboard system and NOT Macaly", () => {
  const action = router.resolveNaturalAction("Aria set dashboard password as daniel");
  assert.ok(action, "Should resolve to an action");
  assert.equal(action.intent, "dashboard", "Should route to dashboard intent");
  assert.notEqual(action.intent, "macaly", "Must NOT route to Macaly");
});

test("Regression: Provider Health Diagnostic Report formats safe status", () => {
  const report = providerHealth.formatDiagnosticReport();
  assert.match(report, /ARIA Provider Diagnostic Report/);
  assert.doesNotMatch(report, /sk-|key-|secret/i);
});

test("Regression: MiniMax 401 error is safely classified with HTTP status and code", () => {
  const mockErr = {
    response: {
      status: 401,
      data: { base_resp: { status_code: "AUTH_FAILED", status_msg: "Invalid API Key" } }
    }
  };
  const parsed = minimax.parseMinimaxError(mockErr);
  assert.equal(parsed.status, 401);
  assert.equal(parsed.code, "AUTH_FAILED");
  assert.match(parsed.formatted, /MINIMAX_REQUEST_FAILED status: 401/);
});

test("Regression: Bad MAC errors are identified and rate limited", () => {
  whatsappDecryption.clearFailureStats();
  const badMac = new Error("Session error: Error: Bad MAC Error: Bad MAC");
  assert.equal(whatsappDecryption.isDecryptionError(badMac), true);
  assert.equal(whatsappDecryption.classifyDecryptionError(badMac), "BAD_MAC");

  whatsappDecryption.handleDecryptionError(badMac, { jid: "test@s.whatsapp.net" });
  const stats = whatsappDecryption.getFailureStats("test@s.whatsapp.net");
  assert.equal(stats.count, 1);
});

test("Regression: Coding task result includes verified project status and evidence", () => {
  const formatter = new ResultFormatter();
  const report = formatter.formatCompleted({
    id: "task_123",
    title: "Build a barbershop website",
    provider: "Local",
    filesChanged: ["index.html", "style.css"],
    verification: ["Build passed", "HTTP 200 responded"]
  });
  assert.match(report, /ARIA Coding Agent Completed Task/);
  assert.match(report, /Build a barbershop website/);
  assert.match(report, /index\.html/);
});
