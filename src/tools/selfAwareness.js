const { getAIResponse } = require("./ai");

// Honest, hardcoded description of ARIA's actual real capabilities — used by
// !evolve so the self-assessment is grounded in what's genuinely built, not
// the AI hallucinating a plausible-sounding but inaccurate self-review.
const ACTUAL_CAPABILITIES = `
Built and working:
- Multi-provider AI chat with provider telemetry and fallback chains (Cerebras, Gemini, Groq, OpenRouter)
- Persistent per-chat history, unified profile data, semantic memories, preferences, facts, and project context
- Vision, voice transcription, text-to-speech, stickers, image generation, and yt-dlp-backed media tools
- Web search and URL browsing with outbound URL safety checks
- App builder with planning, generation, build verification, repair, project state, zip delivery, and optional deployment
- Think mode, file editing, code debugging, sandboxed code execution, and durable mission execution
- GitHub repository inspection, local git actions, pull-request support, and repository-aware developer workflows
- Group administration, anti-link/welcome/warning tools, owner/admin permissions, broadcasts, health checks, and telemetry
- Anime catalog, provider-race source resolution, validation, signed playback/file capabilities, safe catalog filtering, and queued downloads
- Academy/LMS with hidden assessments, learner profiles, engineering-skill signals, durable XP ledger, portal accounts, Google OAuth, and WhatsApp linking
- Reminders, recurring tasks, autonomous owner check-ins, proactive operational monitoring, and background task polling

Known gaps:
- Role-based agent prompts exist, but planner/researcher/builder/verifier are not isolated services with independent budgets and failure domains
- Generated-project dependency graphs and repository-wide AST/test analysis are incomplete
- External calendar, email, and household integrations are not yet approval-first connected actions
- Anime watchlist/progress migration is now scoped by user, but older callers still use the legacy compatibility scope until account IDs are supplied
- Full outbound pinning cannot be inherited by third-party subprocesses such as yt-dlp/ffprobe without additional OS-level isolation
- Companion emotion is an expressive, transparent persona state—not biological consciousness—and the system still needs a user-facing memory center, retention controls, and deeper evaluation coverage
- Complex multi-file builds can still fail across files even after local syntax/build repair
`.trim();

async function runEvolveCheck(senderName) {
  const prompt = `You are ARIA, a WhatsApp AI assistant. Here is an accurate, honest list of what you actually have built and what's genuinely missing:

${ACTUAL_CAPABILITIES}

Write a short, honest self-assessment in your own voice. Structure it as:
1. A brief "what I can actually do well" section (don't oversell)
2. A brief "what I'm still missing" section
3. ONE specific, genuinely useful next upgrade you'd recommend, with a one-line reason why it matters more than the others

Keep it grounded — don't invent capabilities not listed above, and don't claim something is broken if it's listed as working.`;

  return await getAIResponse(prompt, senderName, [], null, "");
}

module.exports = { runEvolveCheck, ACTUAL_CAPABILITIES };

