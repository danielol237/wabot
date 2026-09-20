const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.join(__dirname, "../../data");
const FILE = process.env.ARIA_ACTION_TASK_FILE || path.join(DATA_DIR, "actionTasks.json");
const MAX_TASKS = 100;
const STATES = Object.freeze({ PENDING: "PENDING", RUNNING: "RUNNING", COMPLETED: "COMPLETED", FAILED: "FAILED", SKIPPED: "SKIPPED", NOT_VERIFIED: "NOT_VERIFIED" });
const TERMINAL = new Set([STATES.COMPLETED, STATES.FAILED, STATES.SKIPPED, STATES.NOT_VERIFIED]);

let tasks = [];
try { tasks = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (_) { tasks = []; }
if (!Array.isArray(tasks)) tasks = [];

function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tmp = `${FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(tasks.slice(-MAX_TASKS), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  } catch (_) {}
}

function clean(value, max = 500) { return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max); }
function now() { return new Date().toISOString(); }
function emit(task, event, metadata = {}) {
  try { require("../utils/eventLog").trackOperation("task", task.id, event, { taskId: task.id, taskType: task.type, ...metadata }); } catch (_) {}
}
function createTask({ type = "action", goal = "", chatId = null, metadata = {}, steps = [] } = {}) {
  const task = {
    id: `task_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
    type: clean(type, 80), goal: clean(goal, 1000), chatId: clean(chatId, 180) || null,
    state: STATES.PENDING, createdAt: now(), updatedAt: now(), metadata,
    steps: steps.map((step, index) => ({ id: clean(step.id || `step_${index + 1}`, 80), label: clean(step.label || step.id || `Step ${index + 1}`, 180), dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn.map((id) => clean(id, 80)) : [], state: STATES.PENDING, result: null, error: null, startedAt: null, completedAt: null })),
  };
  tasks.push(task); save(); emit(task, "created"); return task;
}
function getTask(id) { return tasks.find((task) => task.id === id) || null; }
function update(task) { task.updatedAt = now(); save(); return task; }
function findStep(task, stepId) { return task.steps.find((step) => step.id === stepId) || null; }
function setStep(task, stepId, state, patch = {}) {
  const step = findStep(task, stepId); if (!step) throw new Error(`Unknown task step: ${stepId}`);
  step.state = state; Object.assign(step, patch); task.state = state === STATES.FAILED ? STATES.FAILED : task.state; update(task); emit(task, `step-${state.toLowerCase()}`, { stepId, state, error: step.error || undefined }); return step;
}
function dependenciesReady(task, step) {
  return step.dependsOn.every((id) => findStep(task, id)?.state === STATES.COMPLETED);
}
function skipDependents(task, failedStepId, reason) {
  for (const step of task.steps) {
    if (step.state === STATES.PENDING && step.dependsOn.includes(failedStepId)) {
      setStep(task, step.id, STATES.SKIPPED, { error: clean(reason, 300) });
      skipDependents(task, step.id, `Dependency ${failedStepId} did not complete.`);
    }
  }
}
async function runStep(task, stepId, action, options = {}) {
  const step = findStep(task, stepId);
  if (!step) throw new Error(`Unknown task step: ${stepId}`);
  if (step.state !== STATES.PENDING) return step;
  if (!dependenciesReady(task, step)) {
    setStep(task, stepId, STATES.SKIPPED, { error: "Dependency did not complete." });
    return step;
  }
  setStep(task, stepId, STATES.RUNNING, { startedAt: now(), error: null });
  try {
    const result = await action();
    const verified = options.verify ? await options.verify(result) : true;
    if (!verified) {
      setStep(task, stepId, STATES.NOT_VERIFIED, { result: result || null, completedAt: now(), error: "Step completed but could not be verified." });
      skipDependents(task, stepId, "Dependency was not verified.");
      return findStep(task, stepId);
    }
    setStep(task, stepId, STATES.COMPLETED, { result: result || null, completedAt: now() });
    return findStep(task, stepId);
  } catch (error) {
    setStep(task, stepId, STATES.FAILED, { error: clean(error?.message || error, 500), completedAt: now() });
    skipDependents(task, stepId, "Dependency failed.");
    return findStep(task, stepId);
  }
}
function finish(task) {
  if (task.steps.some((step) => step.state === STATES.FAILED)) task.state = STATES.FAILED;
  else if (task.steps.some((step) => step.state === STATES.NOT_VERIFIED)) task.state = STATES.NOT_VERIFIED;
  else if (task.steps.some((step) => step.state === STATES.SKIPPED)) task.state = STATES.FAILED;
  else if (task.steps.length && task.steps.every((step) => step.state === STATES.COMPLETED)) task.state = STATES.COMPLETED;
  else task.state = STATES.NOT_VERIFIED;
  update(task); emit(task, `finished-${task.state.toLowerCase()}`); return task;
}
function summary(task) {
  return { id: task.id, type: task.type, goal: task.goal, state: task.state, steps: task.steps.map(({ id, label, state, result, error, startedAt, completedAt }) => ({ id, label, state, result, error, startedAt, completedAt })), updatedAt: task.updatedAt };
}
function listTasks(filter = {}) { return tasks.filter((task) => !filter.chatId || task.chatId === filter.chatId).slice(-20).reverse().map(summary); }

module.exports = { STATES, createTask, getTask, runStep, finish, summary, listTasks, _test: { tasks, dependenciesReady, skipDependents } };
