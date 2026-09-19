// ── ARIA Capability & Permission Layer ─────────────────────────
// Gates what ARIA's agents can actually DO. Every capability (code execution,
// file write, network call, message send, etc.) must pass this layer before
// running. Rules come from the World Model permission store + a default policy.
//
//   capability(request) → { allowed: true, sandbox: {...} }
//                       | { allowed: false, reason }
//
// Default policy (fail-closed):
//   • code:      allowed ONLY if explicitly granted AND always sandboxed
//   • fileWrite: allowed only within allowed paths
//   • network:   denied by default
//   • sendMessage: allowed (core function)
//   • exec:      denied unless granted

const { isPermissionGranted, getUserModel } = require("../utils/worldModel");

const DEFAULT_ALLOWED = new Set(["sendMessage", "react", "readMemory", "readWorldModel"]);

const CAPABILITY_REQUIRES_GRANT = {
  // Canonical planner-facing names. Natural language stays separate from
  // these internal operations, so routing can evolve without changing tools.
  create_project: "create_project",
  modify_files: "write_files",
  run_validation: "run_validation",
  deploy_project: "deploy_project",
  send_whatsapp_message: "send_whatsapp_message",
  search_web: "network_access",
  store_memory: "store_memory",
  retrieve_memory: "readMemory",
  github: "github_access",
  code: "execute_code",
  fileWrite: "write_files",
  network: "network_access",
  exec: "shell_exec",
  browser: "browser_access",
  voice: "voice_tts",
  image: "image_generation",
};

// Owner bypass — the creator can do anything (checked at caller level normally)
function checkCapability(userId, capability, context = {}) {
  // Core, harmless capabilities are always allowed
  if (DEFAULT_ALLOWED.has(capability)) {
    return { allowed: true, sandbox: {} };
  }

  // Capabilities that require an explicit grant
  const grantKey = CAPABILITY_REQUIRES_GRANT[capability];
  if (!grantKey) {
    // Unknown capability → deny (fail-closed)
    return { allowed: false, reason: `Unknown capability: ${capability}` };
  }

  const granted = isPermissionGranted(userId, grantKey, context.scope || "*");
  if (!granted) {
    return { allowed: false, reason: `Capability "${capability}" not granted. Use !grant ${grantKey} to allow it.` };
  }

  // Sandbox requirements per capability
  const sandbox = {};
  if (capability === "code" || capability === "exec") {
    // Code MUST run sandboxed — never raw
    sandbox.sandboxed = true;
    sandbox.network = false;
    sandbox.memory = context.memory || "128m";
    sandbox.timeout = context.timeout || 15;
  }
  if (capability === "network") sandbox.allowlist = context.allowlist || null;
  if (capability === "fileWrite") sandbox.paths = context.paths || [];

  return { allowed: true, sandbox };
}

// Convenience wrappers
function canExec(userId, scope) {
  return checkCapability(userId, "exec", { scope }).allowed;
}
function canCode(userId, scope) {
  return checkCapability(userId, "code", { scope }).allowed;
}
function canNetwork(userId, scope) {
  return checkCapability(userId, "network", { scope }).allowed;
}

module.exports = { checkCapability, canExec, canCode, canNetwork, DEFAULT_ALLOWED };
