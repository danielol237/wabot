const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-billing-checkout-"));
process.env.ARIA_PLATFORM_DATA_DIR = dataDir;
process.env.ARIA_LIVE_PAYMENTS = "false";
const billing = require("../src/core/billing");

test("billing checkout: paid MTN checkout is pending and cannot self-activate", () => {
  const checkout = billing.beginCheckout({ tenantId: "ten_mtn", planId: "starter", provider: "mtn", actorId: "user_owner" });
  assert.equal(checkout.plan.id, "starter");
  assert.equal(checkout.subscription.status, "pending");
  assert.equal(checkout.intent.status, "pending");
  assert.equal(checkout.provider.mode, "disabled");
  assert.equal(billing.getActiveSubscription("ten_mtn"), null);
  assert.throws(() => billing.reconcilePayment(checkout.intent.id, "succeeded"), (error) => error.code === "LIVE_PAYMENTS_DISABLED");
});

test("billing checkout: manual sandbox reconciliation activates the chosen plan", () => {
  const checkout = billing.beginCheckout({ tenantId: "ten_manual", planId: "starter", provider: "manual", actorId: "user_owner" });
  const reconciled = billing.reconcilePayment(checkout.intent.id, "succeeded", { actorId: "user_owner", externalId: "manual-test-1" });
  assert.equal(reconciled.intent.status, "succeeded");
  assert.equal(reconciled.subscription.status, "active");
  assert.equal(billing.resolveTenantPlan("ten_manual").id, "starter");
});

test("billing checkout: free plan creates an internal trial without a payment intent", () => {
  const checkout = billing.beginCheckout({ tenantId: "ten_free", planId: "free", provider: "mtn" });
  assert.equal(checkout.subscription.status, "trialing");
  assert.equal(checkout.intent, null);
  assert.equal(checkout.activation, "immediate");
});

test.after(() => {
  delete process.env.ARIA_LIVE_PAYMENTS;
  fs.rmSync(dataDir, { recursive: true, force: true });
});
