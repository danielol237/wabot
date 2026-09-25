// Adversarial Critic / Code Reviewer
class Critic {
  review(taskPayload, verificationResult) {
    const diff = verificationResult?.diff || {};
    const testResult = verificationResult?.testResult;

    const findings = [];
    const risks = [];

    if (!diff.hasChanges && (!diff.changedFiles || diff.changedFiles.length === 0)) {
      findings.push("No files were modified to fulfill the request.");
    }

    if (testResult && !testResult.success) {
      findings.push(`Test suite failed with exit code ${testResult.exitCode}: ${testResult.stderr?.slice(0, 300) || "Test failure"}`);
    }

    const approved = findings.length === 0;

    return {
      approved,
      findings,
      risks,
      summary: approved ? "Code review passed with zero critical defects." : `Code review identified ${findings.length} defect(s).`,
    };
  }
}

module.exports = Critic;
