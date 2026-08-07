const { runCode } = require("./codeSandbox");
const { checkCapability } = require("../utils/capabilities");

// ── Sandboxed code execution entrypoint ───────────────────────
// All code execution now flows through the capability layer → Docker sandbox.
// If the capability isn't granted, we deny. If Docker is missing, we refuse
// rather than silently running unsafe code (unless forceUnsafe is set for
// owner-only dev).

async function executeCode(userId, code, lang, context = {}) {
  const { isOwner } = require("../utils/permissions");
  const ownerBypass = isOwner(userId);

  // Owner bypass: the creator always has code capability (still runs sandboxed
  // for their own safety unless they force-opt out). Non-owners go through the
  // capability gate which defaults to DENY.
  let cap = { allowed: true, sandbox: { timeout: 15, memory: "128m" } };
  if (!ownerBypass) {
    cap = checkCapability(userId, "code", {
      scope: context.scope || "*",
      memory: context.memory,
      timeout: context.timeout,
    });
    if (!cap.allowed) {
      return { success: false, output: "❌ " + cap.reason };
    }
  }

  const result = await runCode(code, lang, {
    timeout: cap.sandbox.timeout,
    memory: cap.sandbox.memory,
  });

  if (!result.sandboxed) {
    return { success: false, output: "⚠️ Docker unavailable — sandbox disabled, code blocked.\n" + result.output };
  }
  return result;
}

module.exports = { executeCode, runCode };
