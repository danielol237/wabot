const { getAIResponse } = require("./ai");

// Honest, hardcoded description of ARIA's actual real capabilities — used by
// !evolve so the self-assessment is grounded in what's genuinely built, not
// the AI hallucinating a plausible-sounding but inaccurate self-review.
const ACTUAL_CAPABILITIES = `
Built and working:
- Multi-provider AI chat (Cerebras, Gemini, Groq, OpenRouter fallback chain)
- Per-chat persistent memory + per-user preference memory
- Vision (image analysis via Groq)
- Web search (Tavily/Brave/DuckDuckGo fallback chain) — both manual (!search) and automatic for time-sensitive questions
- App builder: plan → generate → npm build verification → auto-repair → zip → Gofile upload, with project state that persists across restarts (!build, !continue, !status, !projects)
- Think mode (!think) — shows a plan before generating code
- File editing on existing projects (!edit)
- Code debugging (!fix)
- Voice transcription (Groq Whisper) and TTS replies (ElevenLabs/FreeTTS)
- Stickers, image generation, downloads (YouTube/TikTok/etc via yt-dlp)
- Group admin: kick/promote/demote/tagall/antilink/welcome messages/warnings
- Owner/admin permission system, broadcast, health checks, bot stats
- Party games (joke/truth/dare/ship/roast), simple games (tic-tac-toe, dice), card economy
- Reply-to-bot detection using real message ID tracking (not field-guessing)
- Reminders (one-time and recurring)

Known gaps:
- No multi-agent role separation (planner/coder/reviewer are one model with different prompts, not architecturally separate passes)
- No file-dependency graph checking across generated project files
- No GitHub push integration
- No VPS control commands (restart/RAM check via chat)
- No autonomous background tasks (e.g. "watch BTC price and notify me")
- Build quality for complex multi-file projects can still be inconsistent — cross-file awareness during generation is limited
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

