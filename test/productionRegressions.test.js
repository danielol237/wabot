const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/utils/commandRouter");
const providerHealth = require("../src/tools/providerHealth");
const minimax = require("../src/tools/minimax");
const zaiMedia = require("../src/tools/zaiMedia");
const whatsappDecryption = require("../src/utils/whatsappDecryptionHandler");
const deliveryWorkflow = require("../src/tools/deliveryWorkflow");

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

test("Regression: Delivery Report includes verified project status and stage breakdown", () => {
  const report = deliveryWorkflow.formatDeliveryReport({
    project: { projectName: "Test Site", verificationState: "VALID", fileCount: 5, buildVerification: "passed" },
    deployment: { url: "https://test.vercel.app" },
    screenshot: { success: true }
  });
  assert.match(report, /ARIA finished the verified delivery workflow/);
  assert.match(report, /Live website: https:\/\/test\.vercel\.app/);
});
