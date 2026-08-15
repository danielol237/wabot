const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-safety-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.ARIA_LIVE_PAYMENTS = "false";
process.env.ARIA_AUTOPILOT_LIVE = "false";

const platform = require("../src/core");
const crm = require("../src/core/business/crm");
const autopilot = require("../src/core/business/autopilot");

test("platform safety: tenant CRM records cannot cross context boundaries", () => {
  const one = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057", tenantName: "Tenant One" });
  const two = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284058", tenantName: "Tenant Two" });
  const oneContext = platform.contextFor({ userId: one.user.id, tenantId: one.tenant.id, role: "owner", source: "safety-test" });
  const twoContext = platform.contextFor({ userId: two.user.id, tenantId: two.tenant.id, role: "owner", source: "safety-test" });
  const customer = crm.ensureCustomer(oneContext, { name: "Private customer", phone: "237650000001" });
  const lead = crm.createLead(oneContext, { customerId: customer.id, title: "Private opportunity", score: 90 });
  assert.equal(crm.list(twoContext, "customers").some((item) => item.id === customer.id), false);
  assert.equal(crm.list(twoContext, "leads").some((item) => item.id === lead.id), false);
  assert.throws(() => crm.updateLead(twoContext, lead.id, { score: 1 }), /lead not found in tenant/);
  assert.throws(() => crm.createOrder(twoContext, { customerId: customer.id, total: 1 }), /customer not found in tenant/);
});

test("platform safety: live payment transition is blocked while live payments are disabled", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057", tenantName: "Payments Tenant" });
  const intent = platform.billing.createPaymentIntent({ tenantId: workspace.tenant.id, amount: 5000, provider: "mtn", actorId: workspace.user.id });
  assert.equal(intent.status, "pending");
  assert.throws(() => platform.billing.transitionPayment(intent.id, "succeeded", { actorId: workspace.user.id, externalId: "mtn-test" }), /live payment transitions are disabled/i);
  assert.equal(platform.billing.getPaymentIntent(intent.id).status, "pending");
});

test("platform safety: approved follow-up remains unsent when live Autopilot is disabled", async () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057", tenantName: "Autopilot Tenant" });
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner", source: "safety-test" });
  const customer = crm.ensureCustomer(context, { name: "Follow-up customer", phone: "237650000002" });
  const lead = crm.createLead(context, { customerId: customer.id, title: "Follow-up opportunity", score: 75 });
  const followup = crm.scheduleFollowup(context, { customerId: customer.id, leadId: lead.id, message: "Approved but not sent", scheduledAt: new Date(Date.now() - 1000).toISOString() });
  const approved = autopilot.approveFollowup(context, followup.id);
  assert.equal(approved.status, "approved");
  const result = await autopilot.executeApprovedFollowups(context, { now: new Date() });
  assert.equal(result.live, false);
  assert.equal(result.sent.length, 0);
  assert.ok(result.pending.some((item) => item.id === followup.id));
  assert.equal(crm.list(context, "followups", { status: "approved" }).some((item) => item.id === followup.id), true);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
