/**
 * src/agent/CapabilityRegistry.js
 *
 * Authoritative semantic catalog of all capabilities available in ARIA.
 * Provides capability discovery, risk assessment, schema validation, and invocation.
 * The registry itself does NOT contain heavy execution logic; it delegates to dedicated
 * underlying tool implementations and infrastructure.
 */

class CapabilityRegistry {
  constructor() {
    this.capabilities = new Map();
  }

  /**
   * Register a new capability into the catalog.
   * @param {Object} capability
   */
  register(capability) {
    if (!capability || !capability.name) {
      throw new Error("Capability must have a valid 'name'.");
    }

    const entry = {
      name: capability.name,
      description: capability.description || "",
      inputs: capability.inputs || {},
      outputs: capability.outputs || {},
      prerequisites: capability.prerequisites || [],
      risk: capability.risk || "READ", // READ, LOW_RISK_WRITE, AUTHORIZED_WRITE, HIGH_IMPACT, DESTRUCTIVE
      authorization: capability.authorization || "NONE", // NONE, REQUIRED, POLICY_CHECK
      executionEnvironment: capability.executionEnvironment || "IN_PROCESS", // IN_PROCESS, HOST, SANDBOX
      verificationMethod: capability.verificationMethod || "INSPECT_RESULT",
      sideEffects: capability.sideEffects || false,
      implementation: capability.implementation || null
    };

    this.capabilities.set(entry.name, entry);
    return entry;
  }

  /**
   * Get capability metadata by name.
   */
  get(name) {
    return this.capabilities.get(name) || null;
  }

  /**
   * List all registered capabilities.
   */
  list() {
    return Array.from(this.capabilities.values());
  }

  /**
   * Discover capabilities semantically based on intent keywords or query.
   * @param {string} query
   */
  discover(query) {
    if (!query) return this.list();
    const text = String(query).toLowerCase();
    const matches = [];

    for (const cap of this.capabilities.values()) {
      const nameMatch = cap.name.toLowerCase().includes(text);
      const descMatch = cap.description.toLowerCase().includes(text);
      if (nameMatch || descMatch) {
        matches.push(cap);
      }
    }

    return matches;
  }

  /**
   * Execute a capability by name.
   * @param {string} name
   * @param {Object} inputs
   * @param {Object} context
   */
  async execute(name, inputs = {}, context = {}) {
    const cap = this.get(name);
    if (!cap) {
      throw new Error(`Capability '${name}' is not registered in ARIA CapabilityRegistry.`);
    }

    if (typeof cap.implementation !== "function") {
      throw new Error(`Capability '${name}' does not have an executable implementation.`);
    }

    // Check authorization policy level if needed
    if (cap.risk === "DESTRUCTIVE" && !context.userAuthorized) {
      throw new Error(`Capability '${name}' is DESTRUCTIVE and requires explicit user authorization.`);
    }

    return await cap.implementation(inputs, context);
  }
}

// Global Singleton Instance
const defaultRegistry = new CapabilityRegistry();

module.exports = {
  CapabilityRegistry,
  defaultRegistry
};
