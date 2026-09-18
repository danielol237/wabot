// ARIA capability catalog.
// This is operational metadata, not a second command parser: callers use it to
// discover what the system can actually do and what evidence is required before
// reporting success.

const CAPABILITIES = Object.freeze([
  {
    name: "memory.write",
    description: "Persist a user-provided fact or preference for later retrieval.",
    inputSchema: { userId: "string", value: "string" },
    outputSchema: { persisted: "boolean", recordCount: "number" },
    requirements: ["persistent profile storage"],
    permissions: "conversation participant",
    limitations: ["bounded per-user storage"],
  },
  {
    name: "memory.read",
    description: "Read persisted memories and profile facts for a user.",
    inputSchema: { userId: "string" },
    outputSchema: { memories: "array", profile: "object" },
    requirements: ["persistent profile storage"],
    permissions: "conversation participant",
    limitations: ["returns stored records only"],
  },
  {
    name: "project.build",
    description: "Plan, generate, cross-check, validate, test, and package a project.",
    inputSchema: { chatId: "string", goal: "string" },
    outputSchema: { success: "boolean", projectId: "string", validation: "object" },
    requirements: ["coding provider", "filesystem workspace"],
    permissions: "owner for bot engineering operations",
    limitations: ["browser smoke and package builds depend on available runtime tools"],
  },
  {
    name: "project.deploy",
    description: "Deploy a verified project using an available hosting provider and verify its URL.",
    inputSchema: { projectId: "string", target: "string" },
    outputSchema: { success: "boolean", url: "string|null", verified: "boolean" },
    requirements: ["verified project", "hosting credentials"],
    permissions: "owner approval",
    limitations: ["no URL is reported unless deployment and verification succeed"],
  },
  {
    name: "engineering.inspect",
    description: "Inspect an allowlisted repository and produce a bounded, reviewable change plan.",
    inputSchema: { objective: "string", repository: "string" },
    outputSchema: { success: "boolean", proposal: "object|null" },
    requirements: ["repository access for private repositories"],
    permissions: "repository owner",
    limitations: ["never writes directly to main"],
  },
]);

function listCapabilities(filter = {}) {
  const requested = String(filter.category || "").trim().toLowerCase();
  return CAPABILITIES.filter((capability) => !requested || capability.name.startsWith(`${requested}.`))
    .map((capability) => ({ ...capability, inputSchema: { ...capability.inputSchema }, outputSchema: { ...capability.outputSchema }, requirements: [...capability.requirements], limitations: [...capability.limitations] }));
}

function getCapability(name) {
  return listCapabilities().find((capability) => capability.name === String(name || "").trim()) || null;
}

function operationResult({ capability, state, output = null, error = null, evidence = [] } = {}) {
  const validStates = new Set(["PLANNED", "IN_PROGRESS", "WAITING_FOR_INPUT", "WAITING_FOR_PERMISSION", "SUCCEEDED", "FAILED", "PARTIALLY_SUCCEEDED"]);
  const normalizedState = validStates.has(state) ? state : "FAILED";
  return Object.freeze({ capability: String(capability || "unknown"), state: normalizedState, output, error: error ? String(error) : null, evidence: Array.isArray(evidence) ? evidence.slice(0, 20) : [] });
}

module.exports = { CAPABILITIES, listCapabilities, getCapability, operationResult };
