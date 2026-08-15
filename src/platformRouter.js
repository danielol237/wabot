const express = require("express");
const platform = require("./core");
const crm = require("./core/business/crm");
const { checkAuth, csrfOk } = require("./dashboard");

const router = express.Router();

function ownerContext() {
  const workspace = platform.bootstrapOwnerWorkspace();
  if (!workspace) return null;
  return platform.contextFor({ userId: workspace.user.id, tenantId: workspace.tenant.id, role: "owner", source: "dashboard" });
}

function requireContext(req, res, next) {
  const context = ownerContext();
  if (!context) return res.status(503).json({ ok: false, error: "Platform owner workspace is not configured." });
  req.platformContext = context;
  next();
}

function requireMutation(req, res, next) {
  if (!csrfOk(req)) return res.status(403).json({ ok: false, error: "Invalid or missing CSRF token." });
  next();
}

function handle(handler) {
  return async (req, res) => {
    try {
      const value = await handler(req, res);
      if (res.headersSent) return;
      res.json({ ok: true, ...(value && typeof value === "object" ? value : { data: value }) });
    } catch (err) {
      const status = err.code === "CAPABILITY_DENIED" ? 403 : err.code === "ENTITLEMENT_LIMIT_REACHED" ? 402 : 400;
      res.status(status).json({ ok: false, error: String(err.message || "Platform operation failed").slice(0, 300), code: err.code || "PLATFORM_ERROR" });
    }
  };
}

router.use(checkAuth, requireContext);

router.get("/overview", handle((req) => {
  const context = req.platformContext;
  const subscription = platform.billing.getActiveSubscription(context.tenantId);
  return {
    tenant: context.tenant,
    user: { id: context.user.id, displayName: context.user.displayName },
    plan: platform.billing.resolveTenantPlan(context.tenantId),
    subscription,
    business: crm.summary(context),
    usage: platform.usage.summary({ tenantId: context.tenantId, limit: 2000 }),
    events: platform.events.list({ tenantId: context.tenantId, limit: 20 }),
    payments: ["manual", "mtn", "orange"].map((provider) => platform.billing.providerStatus(provider)),
  };
}));

router.get("/plans", handle(() => ({ plans: platform.billing.listPlans() })));
router.get("/business/:type", handle((req) => ({ items: crm.list(req.platformContext, req.params.type, { stage: req.query.stage, status: req.query.status, limit: req.query.limit }) })));

router.post("/customers", requireMutation, handle((req) => ({ customer: crm.ensureCustomer(req.platformContext, req.body || {}) })));
router.post("/leads", requireMutation, handle((req) => ({ lead: crm.createLead(req.platformContext, req.body || {}) })));
router.patch("/leads/:id", requireMutation, handle((req) => ({ lead: crm.updateLead(req.platformContext, req.params.id, req.body || {}) })));
router.post("/conversations", requireMutation, handle((req) => ({ conversation: crm.recordConversation(req.platformContext, req.body || {}) })));
router.post("/knowledge", requireMutation, handle((req) => ({ knowledge: crm.addKnowledge(req.platformContext, req.body || {}) })));
router.post("/followups", requireMutation, handle((req) => ({ followup: crm.scheduleFollowup(req.platformContext, req.body || {}) })));
router.post("/orders", requireMutation, handle((req) => ({ order: crm.createOrder(req.platformContext, req.body || {}) })));
router.post("/payments/intents", requireMutation, handle((req) => ({ intent: platform.billing.createPaymentIntent({ ...req.body, tenantId: req.platformContext.tenantId, actorId: req.platformContext.userId }) })));
router.post("/payments/:id/status", requireMutation, handle((req) => ({ intent: platform.billing.transitionPayment(req.params.id, req.body?.status, { actorId: req.platformContext.userId, externalId: req.body?.externalId, metadata: req.body?.metadata }) })));

module.exports = router;
