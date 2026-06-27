const { getAIResponse } = require("./ai");

const INVESTIGATE_SYSTEM_PROMPT = `You are a senior systems debugger doing root-cause analysis. Given a problem description, you:
1. List 2-4 plausible specific causes, ranked by likelihood
2. Identify the MOST likely cause and explain why
3. Suggest the exact next diagnostic step to confirm it (a specific command to run, file to check, or log to read)

Be concrete and specific to what's described — no generic "check your code" advice. If genuinely insufficient information is given, say what additional detail would help narrow it down.`;

async function investigate(problemDescription, senderName) {
  const prompt = `Problem reported: "${problemDescription}"

Do a root-cause analysis on this.`;

  return await getAIResponse(prompt, senderName, [], INVESTIGATE_SYSTEM_PROMPT, "");
}

module.exports = { investigate };

