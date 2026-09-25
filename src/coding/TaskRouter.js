// Capability-Based Task Router for Coding vs Chat
const JulesProvider = require("./providers/JulesProvider");
const LocalCodingProvider = require("./providers/LocalCodingProvider");
const { isCodingTask } = require("../utils/taskClassifier");
const { log } = require("../utils/logger");

class TaskRouter {
  constructor(options = {}) {
    this.julesProvider = options.julesProvider || new JulesProvider();
    this.localProvider = options.localProvider || new LocalCodingProvider(options.workspacePath);
  }

  isCodingRequest(text) {
    return isCodingTask(text);
  }

  selectProvider(userRequest, options = {}) {
    // If user explicitly requested a provider
    if (options.preferredProvider === "jules") {
      if (this.julesProvider.isAvailable()) return this.julesProvider;
      throw new Error("Jules provider explicitly requested but JULES_API_KEY is not configured.");
    }

    if (options.preferredProvider === "local") {
      return this.localProvider;
    }

    // Default capability-based routing
    if (this.julesProvider.isAvailable() && options.useRemoteAgent !== false) {
      log("[TaskRouter] Selected Jules Remote Provider.");
      return this.julesProvider;
    }

    log("[TaskRouter] Selected Local Autonomous Engineering Provider.");
    return this.localProvider;
  }
}

module.exports = TaskRouter;
