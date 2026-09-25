// Failure Root-Cause Analyzer & Bounded Repair Orchestrator
const Critic = require("../review/Critic");
const VerificationEngine = require("../verification/VerificationEngine");
const { log, warn } = require("../../utils/logger");

class RepairEngine {
  constructor(workspacePath = process.cwd(), maxAttempts = 3, verifier = null) {
    this.workspacePath = workspacePath;
    this.maxAttempts = maxAttempts;
    this.critic = new Critic();
    this.verifier = verifier || new VerificationEngine(workspacePath);
  }

  async runRepairLoop(taskPayload, initialVerification, repairFn, verifyOptions = {}) {
    let verification = initialVerification;
    let review = this.critic.review(taskPayload, verification);
    let attempt = 0;

    while (!review.approved && attempt < this.maxAttempts) {
      attempt++;
      log(`[RepairEngine] Starting repair attempt ${attempt}/${this.maxAttempts} for task ${taskPayload.id}`);

      if (repairFn) {
        try {
          await repairFn({ attempt, review, verification });
        } catch (err) {
          warn(`[RepairEngine] Repair attempt ${attempt} threw error: ${err.message}`);
        }
      }

      verification = await this.verifier.verify(verifyOptions);
      review = this.critic.review(taskPayload, verification);
    }

    return {
      success: review.approved,
      attempts: attempt,
      verification,
      review,
    };
  }
}

module.exports = RepairEngine;
