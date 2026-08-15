const crypto = require("crypto");
const path = require("path");
const { createJsonRepository } = require("../storage/jsonRepository");
const { publish } = require("../events");

const DATA_DIR = process.env.ARIA_PLATFORM_DATA_DIR || path.join(__dirname, "../../../data");
const STORE = createJsonRepository(path.join(DATA_DIR, "platformJobs.json"), () => ({ jobs: {} }));
const DEFAULT_LEASE_MS = Math.max(30_000, Number(process.env.PLATFORM_JOB_LEASE_MS || 120_000));

function id() { return `job_${crypto.randomBytes(10).toString("hex")}`; }
function clean(value, max = 160) { return String(value == null ? "" : value).trim().slice(0, max); }
function nowIso(value = Date.now()) { return new Date(value).toISOString(); }

function enqueue({ tenantId = null, type, payload = {}, runAt = null, maxAttempts = 5, idempotencyKey = null, priority = 0, metadata = {} } = {}) {
  if (!type) throw new Error("job type is required");
  const state = STORE.read();
  if (idempotencyKey) {
    const existing = Object.values(state.jobs).find((job) => job.tenantId === tenantId && job.idempotencyKey === idempotencyKey && !["failed", "cancelled"].includes(job.status));
    if (existing) return { ...existing, duplicate: true };
  }
  const job = {
    id: id(), tenantId: tenantId ? clean(tenantId) : null, type: clean(type, 120), payload: payload && typeof payload === "object" ? JSON.parse(JSON.stringify(payload)) : { value: payload },
    status: "pending", priority: Number(priority) || 0, attempts: 0, maxAttempts: Math.max(1, Math.min(20, Number(maxAttempts) || 5)), runAt: runAt ? new Date(runAt).toISOString() : nowIso(),
    idempotencyKey: idempotencyKey ? clean(idempotencyKey, 180) : null, metadata: metadata || {}, lease: null, lastError: null, createdAt: nowIso(), updatedAt: nowIso(), completedAt: null,
  };
  state.jobs[job.id] = job;
  STORE.write(state);
  publish({ type: "platform.job.enqueued", tenantId: job.tenantId, aggregateType: "job", aggregateId: job.id, payload: { jobType: job.type, runAt: job.runAt, priority: job.priority } });
  return { ...job, duplicate: false };
}

function claim({ workerId = `worker_${process.pid}`, now = Date.now(), leaseMs = DEFAULT_LEASE_MS } = {}) {
  const state = STORE.read();
  const candidates = Object.values(state.jobs).filter((job) => {
    const due = new Date(job.runAt).getTime() <= now;
    const expired = job.status === "processing" && job.lease && new Date(job.lease.expiresAt).getTime() <= now;
    return (job.status === "pending" && due) || (job.status === "retrying" && due) || expired;
  }).sort((a, b) => (b.priority - a.priority) || (new Date(a.runAt) - new Date(b.runAt)));
  const job = candidates[0];
  if (!job) return null;
  job.status = "processing";
  job.attempts += 1;
  job.lease = { workerId: clean(workerId, 120), claimedAt: nowIso(now), expiresAt: nowIso(now + leaseMs) };
  job.updatedAt = nowIso(now);
  STORE.write(state);
  publish({ type: "platform.job.claimed", tenantId: job.tenantId, actorId: workerId, aggregateType: "job", aggregateId: job.id, payload: { jobType: job.type, attempt: job.attempts } });
  return { ...job };
}

function get(jobId) {
  const job = STORE.read().jobs[jobId];
  return job ? { ...job } : null;
}

function complete(jobId, { workerId = null, result = null } = {}) {
  const state = STORE.read();
  const job = state.jobs[jobId];
  if (!job) throw new Error("job not found");
  if (workerId && job.lease?.workerId !== workerId) throw new Error("job lease owner mismatch");
  job.status = "completed"; job.result = result; job.lease = null; job.completedAt = nowIso(); job.updatedAt = job.completedAt;
  STORE.write(state);
  publish({ type: "platform.job.completed", tenantId: job.tenantId, actorId: workerId, aggregateType: "job", aggregateId: job.id, payload: { jobType: job.type, attempts: job.attempts } });
  return { ...job };
}

function fail(jobId, { workerId = null, error = "job failed", retryAt = null } = {}) {
  const state = STORE.read();
  const job = state.jobs[jobId];
  if (!job) throw new Error("job not found");
  if (workerId && job.lease?.workerId !== workerId) throw new Error("job lease owner mismatch");
  job.lastError = clean(error, 600); job.lease = null; job.updatedAt = nowIso();
  if (job.attempts < job.maxAttempts) { job.status = "retrying"; job.runAt = retryAt ? new Date(retryAt).toISOString() : nowIso(Date.now() + Math.min(3600000, 2 ** job.attempts * 1000)); }
  else { job.status = "failed"; job.completedAt = job.updatedAt; }
  STORE.write(state);
  publish({ type: `platform.job.${job.status}`, tenantId: job.tenantId, actorId: workerId, aggregateType: "job", aggregateId: job.id, payload: { jobType: job.type, attempts: job.attempts, error: job.lastError } });
  return { ...job };
}

function cancel(jobId, { actorId = null } = {}) {
  const state = STORE.read();
  const job = state.jobs[jobId];
  if (!job) throw new Error("job not found");
  job.status = "cancelled"; job.lease = null; job.updatedAt = nowIso(); job.completedAt = job.updatedAt;
  STORE.write(state);
  publish({ type: "platform.job.cancelled", tenantId: job.tenantId, actorId, aggregateType: "job", aggregateId: job.id, payload: { jobType: job.type } });
  return { ...job };
}

function list({ tenantId = null, status = null, type = null, limit = 100 } = {}) {
  const max = Math.max(1, Math.min(500, Number(limit) || 100));
  return Object.values(STORE.read().jobs).filter((job) => (!tenantId || job.tenantId === tenantId) && (!status || job.status === status) && (!type || job.type === type)).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)).slice(0, max);
}

async function runOnce({ handlers = {}, workerId = `worker_${process.pid}`, now = Date.now() } = {}) {
  const job = claim({ workerId, now });
  if (!job) return { processed: false, job: null };
  const handler = handlers[job.type];
  if (typeof handler !== "function") return { processed: true, job: fail(job.id, { workerId, error: `No handler registered for ${job.type}` }) };
  try { return { processed: true, job: complete(job.id, { workerId, result: await handler(job) }) }; }
  catch (err) { return { processed: true, job: fail(job.id, { workerId, error: err?.message || err }) }; }
}

module.exports = { STORE, enqueue, claim, get, complete, fail, cancel, list, runOnce };
