const { getAIResponse } = require("./ai");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
// A lightweight multi-step agent: asks the AI to plan steps, executes simple
// tool steps (search/scrape/image), then asks the AI to synthesize a final answer.
// Kept intentionally simple — no infinite loops, max 4 steps, no recursive agent calls.

const MAX_STEPS = 4;

async function runAgentTask(userRequest, senderName) {
  // Step 1: ask the AI to break the task into a short plan
  const planPrompt = `You are a planning assistant. Break this request into at most ${MAX_STEPS} concrete steps using ONLY these tools: SEARCH(query), SCRAPE(url), THINK(note). End with FINAL when ready to answer.

Request: "${userRequest}"

Respond ONLY with a numbered list of steps, one per line, like:
1. SEARCH(best ramen Tokyo)
2. THINK(pick top 3 from results)
3. FINAL`;

  const planText = await getAIResponse(planPrompt, senderName, []);
  const steps = planText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^\d+\.\s*(SEARCH|SCRAPE|THINK|FINAL)/i.test(l))
    .slice(0, MAX_STEPS);

  if (steps.length === 0) {
    // Planning failed — just answer directly instead of erroring out
    return await getAIResponse(userRequest, senderName, []);
  }

  let gatheredInfo = "";

  for (const step of steps) {
    if (/FINAL/i.test(step)) break;

    const searchMatch = step.match(/SEARCH\(([^)]+)\)/i);
    const scrapeMatch = step.match(/SCRAPE\(([^)]+)\)/i);

    if (searchMatch) {
      const result = await searchWeb(searchMatch[1].trim());
      gatheredInfo += `\n\n[Search: ${searchMatch[1]}]\n${result}`;
    } else if (scrapeMatch) {
      const result = await scrapeUrl(scrapeMatch[1].trim());
      gatheredInfo += `\n\n[Scraped: ${scrapeMatch[1]}]\n${result}`;
    }
    // THINK steps don't need execution, they're just planning notes
  }

  // Final synthesis step
  const finalPrompt = `The user asked: "${userRequest}"

Here's the information gathered:${gatheredInfo}

Give a clear, well-organized final answer using this information. Be concise.`;

  return await getAIResponse(finalPrompt, senderName, []);
}

module.exports = { runAgentTask };
