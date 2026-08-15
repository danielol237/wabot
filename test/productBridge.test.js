const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-product-bridge-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.OWNER_NUMBER = "237650284057";

const platform = require("../src/core");
const crm = require("../src/core/business/crm");
const bridge = require("../src/core/productBridge");

test("product bridge: WhatsApp context recognizes only the matching tenant customer and lead", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057", ownerName: "Owner" });
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner", source: "test" });
  const customer = crm.ensureCustomer(context, { name: "Cameroon buyer", phone: "237650000001", source: "whatsapp" });
  const lead = crm.createLead(context, { customerId: customer.id, title: "Laptop order", score: 80, stage: "qualified" });
  const recognized = bridge.revenueContextForWhatsApp({ senderJid: "237650000001@s.whatsapp.net", senderName: "Cameroon buyer", chatId: "chat-1" });
  assert.equal(recognized.customer, null, "a differently formatted WhatsApp identity must not accidentally match a CRM phone");
  assert.equal(recognized.context.tenantId, workspace.tenant.id);
  assert.equal(lead.tenantId, workspace.tenant.id);
  const direct = bridge.revenueContextForWhatsApp({ senderJid: "237650000001", senderName: "Cameroon buyer", chatId: "chat-1" });
  assert.equal(direct.customer.id, customer.id);
  assert.equal(direct.lead.id, lead.id);
});

test("product bridge: records an auditable product event and idempotent usage", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057" });
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner", source: "test" });
  const first = bridge.recordProductActivity({
    product: "test-product",
    action: "request.completed",
    context,
    aggregateType: "request",
    aggregateId: "req-1",
    metadata: { safe: true },
    usage: { category: "test", metric: "requests", units: 2 },
    idempotencyKey: "test-product:req-1",
  });
  assert.equal(first.recorded, true);
  assert.equal(first.usage.units, 2);
  const second = bridge.recordProductActivity({
    product: "test-product",
    action: "request.completed",
    context,
    aggregateType: "request",
    aggregateId: "req-1",
    usage: { category: "test", metric: "requests", units: 2 },
    idempotencyKey: "test-product:req-1",
  });
  assert.equal(second.event.duplicate, true);
  assert.equal(second.usage.duplicate, true);
  assert.ok(platform.audit.listAudit({ tenantId: workspace.tenant.id }).some((item) => item.type === "audit.test-product.request.completed"));
  assert.equal(platform.usage.list({ tenantId: workspace.tenant.id, category: "test", metric: "requests" }).length, 1);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
