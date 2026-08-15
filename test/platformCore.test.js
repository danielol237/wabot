const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-platform-core-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.ARIA_LIVE_PAYMENTS = "false";

const platform = require("../src/core");
const crm = require("../src/core/business/crm");

test("platform core: bootstraps an owner workspace and resolves a tenant context", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057", ownerName: "Daniel", tenantName: "Daniel Workspace" });
  assert.ok(workspace.user.id.startsWith("usr_"));
  assert.ok(workspace.tenant.id.startsWith("ten_"));
  assert.equal(workspace.membership.role, "owner");
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, source: "test" });
  assert.equal(context.role, "owner");
  assert.equal(platform.permissions.can(context.role, "billing.manage"), true);
});

test("platform core: events are idempotent and audit records are tenant-scoped", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057" });
  const first = platform.events.publish({ type: "test.created", tenantId: workspace.tenant.id, actorId: workspace.user.id, idempotencyKey: "test-event-1", payload: { ok: true } });
  const second = platform.events.publish({ type: "test.created", tenantId: workspace.tenant.id, actorId: workspace.user.id, idempotencyKey: "test-event-1", payload: { ok: false } });
  assert.equal(first.id, second.id);
  assert.equal(second.duplicate, true);
  const audit = platform.audit.record({ action: "test.action", tenantId: workspace.tenant.id, actorId: workspace.user.id, resourceType: "test", resourceId: first.id });
  assert.equal(audit.type, "audit.test.action");
  assert.ok(platform.audit.listAudit({ tenantId: workspace.tenant.id }).some((item) => item.id === audit.id));
});

test("platform core: usage, entitlements, subscription, and sandbox payment lifecycle work together", () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057" });
  const usage = platform.usage.record({ tenantId: workspace.tenant.id, actorId: workspace.user.id, category: "ai", metric: "messages", units: 3, estimatedCost: 0.01, idempotencyKey: "usage-1" });
  assert.equal(usage.units, 3);
  const free = platform.billing.entitlementForTenant({ tenantId: workspace.tenant.id, key: "ai_messages_month", requested: 1 });
  assert.equal(free.allowed, true);
  const subscription = platform.billing.createSubscription({ tenantId: workspace.tenant.id, planId: "starter", actorId: workspace.user.id, status: "trialing" });
  assert.equal(subscription.planId, "starter");
  const intent = platform.billing.createPaymentIntent({ tenantId: workspace.tenant.id, subscriptionId: subscription.id, amount: 5000, provider: "manual", actorId: workspace.user.id });
  assert.equal(intent.status, "pending");
  const paid = platform.billing.transitionPayment(intent.id, "succeeded", { actorId: workspace.user.id });
  assert.equal(paid.status, "succeeded");
  assert.equal(platform.billing.providerStatus("mtn").canCapture, false);
});

test("platform core: Revenue Engine records tenant-scoped customers, leads, follow-ups, orders, and analytics", async () => {
  const workspace = platform.bootstrapOwnerWorkspace({ ownerNumber: "237650284057" });
  const context = platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, source: "test" });
  const customer = crm.ensureCustomer(context, { name: "Acme Electronics", phone: "+237 650 000 001", source: "whatsapp" });
  const lead = crm.createLead(context, { customerId: customer.id, title: "iPhone 15", value: 450000, score: 85, stage: "qualified" });
  const conversation = crm.recordConversation(context, { customerId: customer.id, body: "Can I pay in installments?", intent: "purchase", sentiment: "interested" });
  const knowledge = crm.addKnowledge(context, { title: "Installment policy", content: "Ask the finance desk to confirm terms.", tags: ["payments"] });
  const followup = crm.scheduleFollowup(context, { leadId: lead.id, message: "Following up on the iPhone 15.", scheduledAt: new Date(Date.now() + 3600000).toISOString() });
  const dueFollowup = crm.scheduleFollowup(context, { leadId: lead.id, message: "A due proposal.", scheduledAt: new Date(Date.now() - 60000).toISOString() });
  const order = crm.createOrder(context, { customerId: customer.id, leadId: lead.id, total: 450000, status: "paid" });
  const summary = crm.summary(context);
  const autopilot = require("../src/core/business/autopilot");
  const recommendations = autopilot.recommendations(context);
  assert.ok(recommendations.dueFollowups.some((item) => item.followup.id === dueFollowup.id));
  const approved = autopilot.approveFollowup(context, dueFollowup.id);
  assert.equal(approved.status, "approved");
  const execution = await autopilot.executeApprovedFollowups(context, { now: new Date() });
  assert.equal(execution.live, false);
  assert.ok(execution.pending.some((item) => item.id === dueFollowup.id));
  assert.equal(conversation.customerId, customer.id);
  assert.equal(knowledge.tenantId, workspace.tenant.id);
  assert.equal(followup.leadId, lead.id);
  assert.equal(order.total, 450000);
  assert.equal(summary.customers, 1);
  assert.equal(summary.leads, 1);
  assert.equal(summary.revenue, 450000);
  assert.equal(summary.byStage.qualified, 1);
});

test.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
