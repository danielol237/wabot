const test = require("node:test");
const assert = require("node:assert/strict");
const { formatDeliveryReport, verifyLiveUrl } = require("../src/tools/deliveryWorkflow");
const router = require("../src/utils/commandRouter");

test("delivery workflow formats verified project, live URL, and screenshot summary", () => {
  const report = formatDeliveryReport({
    project: { projectName: "ARIA Portfolio", verificationState: "VALID", fileCount: 8, buildVerification: "passed", browserSmoke: { success: true } },
    deployment: { url: "https://aria.example" },
    github: { url: "https://github.com/example/aria-portfolio" },
  });
  assert.match(report, /ARIA finished the delivery workflow/);
  assert.match(report, /https:\/\/aria\.example/);
  assert.match(report, /Browser smoke: \*passed\*/);
  assert.match(report, /github\.com\/example\/aria-portfolio/);
});

test("delivery workflow reports missing live URL without throwing", async () => {
  const result = await verifyLiveUrl("");
  assert.equal(result.success, false);
  assert.match(result.error, /No live URL/);
});

test("delivery command is owner-only and has intuitive aliases", () => {
  const command = router.commands.find((item) => item.name === "deliver");
  assert.ok(command);
  assert.equal(command.ownerOnly, true);
  assert.deepEqual(command.aliases, ["buildsite"]);
});

test("natural delivery request resolves without requiring a bot name", () => {
  const action = router.resolveNaturalAction("build a website and give me the link for a portfolio");
  assert.equal(action?.intent, "deliver");
  assert.equal(action?.command?.name, "deliver");
  assert.equal(action?.command?.ownerOnly, true);
});
