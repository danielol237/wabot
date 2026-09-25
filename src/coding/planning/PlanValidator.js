// Strict Plan Validator - Eliminates Generic Failure Messages
class PlanValidator {
  validate(plan, contextInfo = {}) {
    const discovery = contextInfo.discovery || {};
    const errors = [];
    const missingInfo = [];

    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
      errors.push("Plan contains no executable steps.");
    }

    if (!discovery.projectType || discovery.projectType === "generic") {
      missingInfo.push("Unrecognized or generic project build system.");
    }

    const hasVerification = plan?.steps?.some(
      (s) => (s.verification && s.verification.length > 0) || s.title?.toLowerCase().includes("test") || s.title?.toLowerCase().includes("verify")
    );

    if (!hasVerification) {
      errors.push("Plan lacks verification steps.");
    }

    if (errors.length > 0) {
      return {
        valid: false,
        reason: "PLAN_BLOCKED",
        errors,
        missingInfo,
        evidence: {
          projectType: discovery.projectType,
          scripts: discovery.scripts,
          stepCount: plan?.steps?.length || 0,
        },
        resolution: "Ensure project contains recognized test/build configuration or supply target verification commands.",
      };
    }

    return {
      valid: true,
      plan,
    };
  }
}

module.exports = PlanValidator;
