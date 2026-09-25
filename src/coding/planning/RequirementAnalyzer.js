// Requirements Extractor & Task Classifier
class RequirementAnalyzer {
  analyze(userRequest, discoveryInfo = {}) {
    const text = String(userRequest || "").trim();
    const lower = text.toLowerCase();

    let type = "feature";
    if (/\b(?:fix|bug|error|failing|broken|crash|issue|patch|repair)\b/i.test(lower)) {
      type = "bugfix";
    } else if (/\b(?:refactor|clean|restructure|reorganize)\b/i.test(lower)) {
      type = "refactor";
    } else if (/\b(?:debug|diagnose|find|investigate)\b/i.test(lower)) {
      type = "debug";
    } else if (/\b(?:test|coverage|unit\s*test)\b/i.test(lower)) {
      type = "test";
    } else if (/\b(?:website|web\s*app|site|landing\s+page)\b/i.test(lower)) {
      type = "website";
    }

    const requirements = [text];
    const constraints = ["Preserve existing unrelated functionality", "Do not write credentials or secrets to disk"];
    const acceptanceCriteria = [];

    if (type === "bugfix") {
      acceptanceCriteria.push("Root cause identified and corrected");
      acceptanceCriteria.push("All unit and integration tests pass without regression");
    } else if (type === "website") {
      acceptanceCriteria.push("Website framework/structure created or updated");
      acceptanceCriteria.push("Build and static checks pass");
    } else {
      acceptanceCriteria.push("Requested feature implemented per description");
      acceptanceCriteria.push("Project tests pass");
    }

    let riskLevel = "low";
    if (/\b(?:database|schema|auth|authentication|permissions|security|payment|encryption)\b/i.test(lower)) {
      riskLevel = "high";
    } else if (type === "refactor" || type === "website") {
      riskLevel = "medium";
    }

    return {
      type,
      title: text.slice(0, 80),
      description: text,
      requirements,
      constraints,
      acceptanceCriteria,
      riskLevel,
    };
  }
}

module.exports = RequirementAnalyzer;
