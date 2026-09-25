// Executable Implementation Plan Generator
class PlanGenerator {
  generatePlan(reqAnalysis, archAnalysis) {
    const steps = [];
    let stepId = 1;

    steps.push({
      id: `step_${stepId++}`,
      title: "Inspect target code & codebase context",
      description: "Verify current file contents and local environment state.",
      files: archAnalysis.targetFiles,
      status: "pending",
    });

    steps.push({
      id: `step_${stepId++}`,
      title: "Apply changes and implement solution",
      description: `Execute core changes for ${reqAnalysis.type}: ${reqAnalysis.title}`,
      files: archAnalysis.targetFiles,
      status: "pending",
    });

    if (archAnalysis.testScript) {
      steps.push({
        id: `step_${stepId++}`,
        title: "Run automated test suite",
        description: `Execute project tests using '${archAnalysis.testScript}'`,
        verification: [archAnalysis.testScript],
        status: "pending",
      });
    }

    steps.push({
      id: `step_${stepId++}`,
      title: "Review diff & perform final verification",
      description: "Perform critic review, inspect diff evidence, and verify acceptance criteria.",
      verification: ["diff-inspection", "criteria-check"],
      status: "pending",
    });

    return {
      title: reqAnalysis.title,
      summary: `Executable plan for ${reqAnalysis.type}`,
      steps,
      acceptanceCriteria: reqAnalysis.acceptanceCriteria,
    };
  }
}

module.exports = PlanGenerator;
