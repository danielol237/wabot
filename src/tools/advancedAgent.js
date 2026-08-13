// ── Advanced AI Agent ───────────────────────────────────────
// Executes multi-step plans: SEARCH → SCRAPE → CODE → WRITE → THINK → DONE.
// Each step calls the AI with context from previous steps. Every step the
// planner can emit is actually executed here (audit #38/#39: WRITE and THINK
// were advertised but dropped — now both are real).

const { getAIResponse } = require("./ai");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
const { runCode } = require("./codeRunner");
const fs = require("fs");
const path = require("path");

const MAX_STEPS = 8;
// Safe workspace for the agent's WRITE steps. Scoped to a temp dir so the agent
// can't write anywhere it shouldn't.
const AGENT_WS = path.join(__dirname, "../../temp/agent-workspace");
try { fs.mkdirSync(AGENT_WS, { recursive: true }); } catch (_) {}

// Parse `WRITE(file.xyz) <content>` — everything after the WRITE(...) token is
// file content. Filename must be a bare basename (no slashes / traversal).
function parseWriteStep(step) {
  const m = step.match(/WRITE\(([^)]+)\)([\s\S]*)/i);
  if (!m) return null;
  const name = (m[1] || "").trim();
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return null; // reject paths/traversal
  const content = (m[2] || "").trim();
  return { name, content };
}

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
      context += `\n[SEARCH: ${q}]\n${typeof result === "string" ? result : (result?.output || result?.error || "no result")}\n`;
    }

    if (upper.includes("SCRAPE(")) {
      const url = step.match(/SCRAPE\(([^)]+)\)/i)?.[1];
      if (url && onProgress) onProgress(`🌐 Loading: ${url}`);
      const result = await scrapeUrl(url);
      context += `\n[SCRAPED: ${url}]\n${result?.slice(0, 1000)}\n`;
    }

    if (upper.includes("WRITE(")) {
      const w = parseWriteStep(step);
      if (w) {
        if (onProgress) onProgress(`📝 Writing ${w.name}...`);
        const fp = path.join(AGENT_WS, w.name);
        try {
          fs.writeFileSync(fp, w.content);
          context += `\n[WRITE ${w.name}]\nWrote ${w.content.length} bytes to temp/agent-workspace/${w.name}\n`;
        } catch (e) {
          context += `\n[WRITE ${w.name}]\nFailed to write: ${e.message}\n`;
        }
      } else {
        context += `\n[WRITE]\nIgnored malformed WRITE step (must be WRITE(filename) with a plain filename).\n`;
      }
    }

    if (upper.includes("THINK(")) {
      const note = step.match(/THINK\(([^)]*)\)/i)?.[1]?.trim();
      if (note) context += `\n[THINK] ${note}\n`;
    }

    if (upper.includes("CODE(")) {
      const codeMatch = step.match(/CODE\((\w+)\)\s*([\s\S]*?)ENDCODE/i);
      if (codeMatch) {
        const lang = codeMatch[1];
        const code = codeMatch[2].trim();
        if (code && onProgress) onProgress(`💻 Running ${lang} code...`);
        const result = await runCode(code, lang);
        // runCode returns { success, output } — feed the actual output, not the object.
        codeOutput += `\n[CODE ${lang} OUTPUT]\n${typeof result === "string" ? result : (result?.output || "no output")}\n`;
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

module.exports = { runAgent, parseWriteStep };
