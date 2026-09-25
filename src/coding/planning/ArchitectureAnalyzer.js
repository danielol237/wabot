// Architectural Impact & Affected File Estimator
class ArchitectureAnalyzer {
  analyze(reqAnalysis, contextInfo = {}) {
    const discovery = contextInfo.discovery || {};
    const relevantFiles = contextInfo.relevantFiles || [];

    const affectedFiles = relevantFiles.map((f) => f.path);
    const requiredScripts = [];

    if (discovery.scripts?.test) {
      requiredScripts.push("npm test");
    }

    return {
      projectType: discovery.projectType || "nodejs",
      targetFiles: affectedFiles,
      testScript: discovery.scripts?.test || null,
      buildScript: discovery.scripts?.build || null,
      verificationCommands: requiredScripts,
    };
  }
}

module.exports = ArchitectureAnalyzer;
