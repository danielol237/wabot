// ── Advanced AI Agent ───────────────────────────────────────
// Executes multi-step plans: search → analyze → code → test → fix
// Each step calls the AI with context from previous steps

const { getAIResponse } = require("./ai");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
const { runCode } = require("./codeRunner");

const MAX_STEPS = 8;

async function runAgent(task, senderName, onProgress) {
  // Step 1: Plan
  if (onProgress) onProgress("📋 Planning...");
  const plan = await getAIResponse(
    `Break this task into steps (max ${MAX_STEPS}). Only use: SEARCH, SCRAPE, CODE, WRITE, THINK, DONE.\n\nTask: ${task}\n\nRespond with numbered steps like:\n1. SEARCH(query)\n2. SCRAPE(url)\n3. CODE(language) followed by the code on the next line then ENDCODE on its own line\n4. THINK(note)\n5. DONE`,
    senderName, [],
    null, "You are a task planner. Output ONLY a numbered plan. No extra text."
  );

  // Split into steps but keep multi-line CODE blocks intact: lines that don't
  // start a new numbered step get appended to the previous step so a
  // `3. CODE(js)\n   <code>\n   ENDCODE` block survives as one step.
  const rawLines = plan.split("\n").map((l) => l.trim()).filter(Boolean);
  const steps = [];
  for (const line of rawLines) {
    if (/^\d+\.\s*(SEARCH|SCRAPE|CODE|THINK|DONE)/i.test(line)) {
      steps.push(line);
    } else if (steps.length > 0) {
      steps[steps.length - 1] += "\n" + line;
    }
    if (steps.length >= MAX_STEPS) break;
  }

  if (steps.length === 0) {
    // Direct answer
    return await getAIResponse(task, senderName, []);
  }

  let context = "";
  let codeOutput = "";
  let files = [];

  for (const step of steps) {
    const upper = step.toUpperCase();

    if (upper.includes("SEARCH(")) {
      const q = step.match(/SEARCH\(([^)]+)\)/i)?.[1];
      if (q && onProgress) onProgress(`🔍 Searching: ${q}`);
      const result = await searchWeb(q);
      context += `\n[SEARCH: ${q}]\n${result}\n`;
    }

    if (upper.includes("SCRAPE(")) {
      const url = step.match(/SCRAPE\(([^)]+)\)/i)?.[1];
      if (url && onProgress) onProgress(`🌐 Loading: ${url}`);
      const result = await scrapeUrl(url);
      context += `\n[SCRAPED: ${url}]\n${result?.slice(0, 1000)}\n`;
    }

    if (upper.includes("CODE(")) {
      const codeMatch = step.match(/CODE\((\w+)\)\s*([\s\S]*?)ENDCODE/i);
      if (codeMatch) {
        const lang = codeMatch[1];
        const code = codeMatch[2].trim();
        if (code && onProgress) onProgress(`💻 Running ${lang} code...`);
        const result = await runCode(code, lang);
        codeOutput += `\n[CODE ${lang} OUTPUT]\n${result}\n`;
        context += codeOutput;
      }
    }

    if (upper.includes("DONE")) break;
  }

  // Final synthesis
  if (onProgress) onProgress("🧠 Synthesizing results...");
  const finalPrompt = `Task: ${task}\n\nInformation gathered:\n${context.slice(0, 4000)}\n\nGive a complete, well-organized answer.`;
  return await getAIResponse(finalPrompt, senderName, []);
}

module.exports = { runAgent };
