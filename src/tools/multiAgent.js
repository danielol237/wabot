// ── Multi-Agent Team ──────────────────────────────────────
// Planner -> Coder -> Reviewer -> Debugger -> Tester
// Each agent specializes in one role

const { getAIResponse } = require("./ai");

const AGENT_PROMPTS = {
  planner: "You are a software architect. Design the complete file structure and architecture for the requested project. Output ONLY a JSON array of {path, description, dependencies}. No other text.",
  coder: "You are a senior engineer. Write COMPLETE, production-ready code. No placeholders. No shortcuts. Output ONLY the raw file content.",
  reviewer: "You are a code reviewer. Find bugs, security issues, and improvements. Output a JSON array of {file, line, severity, issue, fix}. If no issues, output []. No other text.",
  debugger: "You are a debugger. Given an error and code, fix the bug and return the COMPLETE corrected file. Output ONLY the corrected code.",
  tester: "You are a QA engineer. Write test cases. Output a JSON array of {test, input, expected}. No other text.",
};

async function runTeamProject(request, senderName, onProgress) {
  const stages = ["planner", "coder", "reviewer", "debugger", "tester"];
  let projectFiles = {};
  let results = {};

  for (const stage of stages) {
    const stageName = stage.charAt(0).toUpperCase() + stage.slice(1);
    if (onProgress) onProgress("Agent: " + stageName);

    if (stage === "planner") {
      const plan = await getAIResponse(request, senderName, [], AGENT_PROMPTS.planner, "");
      try {
        const cleaned = plan.replace(/```json|```/g, "").trim();
        const files = JSON.parse(cleaned);
        projectFiles = Array.isArray(files) ? files.slice(0, 8) : [{ path: "index.html", description: "Main" }];
        results.plan = projectFiles;
      } catch (e) {
        results.plan = [{ path: "index.html", description: "Main" }];
        projectFiles = results.plan;
      }
    } else if (stage === "coder") {
      for (const file of projectFiles) {
        if (onProgress) onProgress("Writing " + file.path);
        const contextStr = projectFiles.map((f) => f.path + ": " + f.description).join("\n");
        const prompt = "Project: " + request + "\n\nFile: " + file.path + "\nPurpose: " + file.description + "\n\nProject structure:\n" + contextStr + "\n\nWrite the COMPLETE file.";
        const code = await getAIResponse(prompt, senderName, [], AGENT_PROMPTS.coder, "");
        results["code_" + file.path] = { path: file.path, content: code };
      }
    } else if (stage === "reviewer") {
      const allCode = Object.entries(results)
        .filter(([k]) => k.startsWith("code_"))
        .map(([k, v]) => "=== " + v.path + " ===\n" + v.content)
        .join("\n\n");
      const review = await getAIResponse("Review this project:\n\n" + allCode, senderName, [], AGENT_PROMPTS.reviewer, "");
      try {
        results.review = JSON.parse(review.replace(/```json|```/g, "").trim());
      } catch (e) {
        results.review = [];
      }
    } else if (stage === "debugger" && results.review?.length > 0) {
      for (const issue of results.review.slice(0, 3)) {
        if (onProgress) onProgress("Fixing " + issue.file);
        const codeKey = Object.keys(results).find((k) => k.startsWith("code_") && results[k].path === issue.file);
        if (codeKey) {
          const fix = await getAIResponse("Fix in " + issue.file + ": " + issue.issue + "\n\nCode:\n" + results[codeKey].content, senderName, [], AGENT_PROMPTS.debugger, "");
          results[codeKey].content = fix;
        }
      }
    } else if (stage === "tester") {
      const allCode = Object.entries(results)
        .filter(([k]) => k.startsWith("code_"))
        .map(([k, v]) => "=== " + v.path + " ===\n" + v.content)
        .join("\n\n");
      results.tests = await getAIResponse("Write tests for:\n\n" + allCode, senderName, [], AGENT_PROMPTS.tester, "");
    }
  }

  if (onProgress) onProgress("Project complete!");
  return results;
}

module.exports = { runTeamProject };
