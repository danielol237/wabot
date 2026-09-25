// Multi-Layer Verification Orchestrator
const TestRunner = require("./TestRunner");
const BuildVerifier = require("./BuildVerifier");
const DiffAnalyzer = require("./DiffAnalyzer");

class VerificationEngine {
  constructor(workspacePath = process.cwd()) {
    this.testRunner = new TestRunner(workspacePath);
    this.buildVerifier = new BuildVerifier(workspacePath);
    this.diffAnalyzer = new DiffAnalyzer(workspacePath);
  }

  async verify(options = {}) {
    const diff = await this.diffAnalyzer.analyzeDiff();

    let testResult = null;
    if (options.testScript) {
      testResult = await this.testRunner.runTests(options.testScript);
    }

    let buildResult = null;
    if (options.buildScript) {
      buildResult = await this.buildVerifier.verifyBuild(options.buildScript);
    }

    const verified = (testResult ? testResult.success : true) && (buildResult ? buildResult.success : true);

    return {
      verified,
      diff,
      testResult,
      buildResult,
    };
  }
}

module.exports = VerificationEngine;
