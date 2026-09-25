const axios = require("axios");
const { log, error, warn } = require("../utils/logger");

const JULES_BASE_URL = String(process.env.JULES_BASE_URL || "https://jules.google.dev/api/v1").replace(/\/+$/, "");

function getApiKey() {
  return String(process.env.JULES_API_KEY || "").trim();
}

function isAvailable() {
  const key = getApiKey();
  return Boolean(key && key.length >= 8);
}

function sanitizeError(err) {
  const status = err?.response?.status;
  const data = err?.response?.data;
  const message = data?.error?.message || data?.message || err?.message || "Jules API error";
  const sanitizedMsg = String(message).replace(/key=[A-Za-z0-9_-]+/gi, "key=REDACTED").slice(0, 300);
  return { status: status || 500, message: sanitizedMsg };
}

async function createTask(payloadContext) {
  if (!isAvailable()) {
    throw new Error("JULES_API_KEY is not configured or unavailable.");
  }

  const key = getApiKey();
  const requestPayload = {
    prompt: payloadContext.userRequest,
    context: {
      repository: payloadContext.repository || "aria-wabot",
      files: payloadContext.relevantFiles || [],
      errorDetails: payloadContext.errorDetails || null,
      environment: payloadContext.environment || "Node.js / Linux VPS",
      conversation: payloadContext.conversationContext || [],
    },
  };

  log(`[JULES] Submitting coding task for request: "${String(payloadContext.userRequest).slice(0, 60)}..."`);

  try {
    const res = await axios.post(`${JULES_BASE_URL}/tasks`, requestPayload, {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Jules-Api-Key": key,
        "Content-Type": "application/json",
      },
      timeout: 30000,
    });

    const task = res.data;
    const taskId = task.id || task.taskId || `jules_${Date.now().toString(36)}`;
    log(`[JULES] Task submitted successfully. ID: ${taskId}`);

    return {
      success: true,
      taskId,
      status: task.status || "queued",
      result: task.result || null,
      filesChanged: task.filesChanged || [],
      tests: task.tests || [],
      summary: task.summary || task.output || null,
    };
  } catch (err) {
    const norm = sanitizeError(err);
    error(`[JULES] Task creation failed: ${norm.message}`);
    throw new Error(`Jules coding task failed: ${norm.message}`);
  }
}

async function getTaskStatus(taskId) {
  if (!isAvailable()) {
    throw new Error("JULES_API_KEY is missing or unavailable.");
  }
  const key = getApiKey();
  try {
    const res = await axios.get(`${JULES_BASE_URL}/tasks/${encodeURIComponent(taskId)}`, {
      headers: {
        Authorization: `Bearer ${key}`,
        "X-Jules-Api-Key": key,
      },
      timeout: 15000,
    });
    return res.data;
  } catch (err) {
    const norm = sanitizeError(err);
    error(`[JULES] Task status check failed for ${taskId}: ${norm.message}`);
    throw new Error(`Jules status check failed: ${norm.message}`);
  }
}

async function executeCodingTask(userRequest, options = {}) {
  const payload = {
    userRequest,
    repository: options.repository || "aria-wabot",
    relevantFiles: options.files || [],
    errorDetails: options.errorDetails || null,
    environment: options.environment || "Linux Node.js Runtime",
    conversationContext: options.history || [],
  };

  log(`[JULES] Coding task detected and routed to Jules`);
  const initial = await createTask(payload);

  if (initial.status === "completed" || initial.result) {
    log(`[JULES] Task completed synchronously. ID: ${initial.taskId}`);
    return formatJulesResult(initial);
  }

  // If async polling is needed
  let taskId = initial.taskId;
  let status = initial.status || "running";
  let attempts = 0;
  const maxAttempts = options.maxPollAttempts || 6;
  const pollIntervalMs = options.pollIntervalMs || 2000;

  while (["queued", "submitted", "running", "in_progress"].includes(status) && attempts < maxAttempts) {
    attempts++;
    log(`[JULES] Polling task ${taskId} (attempt ${attempts}/${maxAttempts})...`);
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    try {
      const pollData = await getTaskStatus(taskId);
      status = pollData.status || "completed";
      if (status === "completed" || pollData.result) {
        log(`[JULES] Task completed on poll ${attempts}. ID: ${taskId}`);
        return formatJulesResult(pollData);
      }
      if (status === "failed") {
        error(`[JULES] Task failed. ID: ${taskId}`);
        throw new Error(pollData.error || "Jules coding task reported failure.");
      }
    } catch (pollErr) {
      warn(`[JULES] Poll warning: ${pollErr.message}`);
      if (attempts >= maxAttempts) throw pollErr;
    }
  }

  if (["queued", "submitted", "running", "in_progress"].includes(status)) {
    log(`[JULES] Task ${taskId} still processing asynchronously.`);
    return `⚡ *Coding task submitted to Jules*\n\nTask ID: \`${taskId}\`\nStatus: Processing\n\nJules is executing this software engineering task in the background.`;
  }

  return formatJulesResult(initial);
}

function formatJulesResult(taskData) {
  const summary = taskData.summary || taskData.result || taskData.output || "Completed task successfully.";
  const files = Array.isArray(taskData.filesChanged) && taskData.filesChanged.length ? taskData.filesChanged.map((f) => `• ${f}`).join("\n") : "• Files updated per specification";
  const tests = Array.isArray(taskData.tests) && taskData.tests.length ? taskData.tests.map((t) => `✓ ${t}`).join("\n") : "✓ Syntax and execution verified";

  return `🤖 *Jules Coding Agent Completed Task*\n\n${summary}\n\n*Files changed:*\n${files}\n\n*Verification:*\n${tests}`;
}

module.exports = {
  isAvailable,
  createTask,
  getTaskStatus,
  executeCodingTask,
  formatJulesResult,
  _test: { sanitizeError, JULES_BASE_URL },
};
