const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-observer-test-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.OWNER_NUMBER = "237650284057";
const observer = require("../src/core/business/observer");
const platform = require("../src/core");
const crm = require("../src/core/business/crm");

test("business observer: private purchase intent creates one customer, lead, and conversation", () => {
  const first = observer.observeWhatsAppMessage({ text: "I am interested, how much is delivery and where can I pay?", senderJid: "237650000001@s.whatsapp.net", senderName: "Alex", chatId: "237650000001@s.whatsapp.net", isGroup: false });
  assert.equal(first.observed, true);
  assert.equal(first.createdLead, true);
  assert.equal(first.lead.stage, "new");
  assert.equal(first.lead.score, 65);
  const second = observer.observeWhatsAppMessage({ text: "I want to buy it now. Send me the price.", senderJid: "237650000001@s.whatsapp.net", senderName: "Alex", chatId: "237650000001@s.whatsapp.net", isGroup: false });
  assert.equal(second.observed, true);
  assert.equal(second.createdLead, false);
  const workspace = platform.bootstrapOwnerWorkspace();
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner" });
  assert.equal(crm.list(context, "customers").length, 1);
  assert.equal(crm.list(context, "leads").length, 1);
  assert.equal(crm.list(context, "conversations").length, 2);
});

test("business observer: group sales chatter is not captured automatically", () => {
  const result = observer.observeWhatsAppMessage({ text: "How much is the product?", senderJid: "237650000002@s.whatsapp.net", senderName: "Group member", chatId: "12345@g.us", isGroup: true });
  assert.equal(result.observed, false);
  assert.equal(result.reason, "not-sales-intent");
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
