const { ACTUAL_CAPABILITIES } = require("./selfAwareness");

function configured(name) {
  return Boolean(String(process.env[name] || "").trim());
}

let runtimeCache = { at: 0, value: null };
function runtimeStatus() {
  if (runtimeCache.value && Date.now() - runtimeCache.at < 30_000) return runtimeCache.value;
  let environment = null;
  try { environment = require("../utils/capabilityCatalog").inspectEnvironment(); } catch (_) {}
  let health = null;
  try { health = require("./providerHealth").getHealth(); } catch (_) {}
  let media = null;
  try { media = require("../utils/mediaRuntime").inspectYtDlp(); } catch (_) { media = { available: false, error: "media runtime unavailable" }; }
  const healthResults = health?.results || [];
  const healthy = healthResults.filter((item) => item.ok).map((item) => item.name);
  const keyed = ["OPENROUTER_API_KEY", "GROQ_API_KEY", "GEMINI_API_KEY", "CEREBRAS_API_KEY"].filter(configured);
  const value = {
    healthyProviders: healthy,
    configuredProviders: keyed,
    ytDlp: media,
    visionReady: configured("ZHIPU_API_KEY") || configured("GROQ_API_KEY") || configured("OPENROUTER_API_KEY"),
    vercelReady: configured("VERCEL_TOKEN"),
    webReady: configured("TAVILY_API_KEY") || configured("BRAVE_API_KEY"),
    environment,
  };
  runtimeCache = { at: Date.now(), value };
  return value;
}

function getCapabilityProfile() {
  const runtime = runtimeStatus();
  const providerLabel = runtime.healthyProviders.length ? `AI provider health confirmed: ${runtime.healthyProviders.join(", ")}` : runtime.configuredProviders.length ? "AI credentials exist, but live provider health has not been confirmed" : "AI provider chain needs a configured credential";
  return {
    immediate: [
      "Natural conversation with persistent memory across short-term and durable history, profile facts, preferences, mood, and dialogue-loop awareness",
      "Context-aware sticker/image understanding, exact visual detail and readable-text extraction when a vision provider is configured",
      "Voice-note transcription and optional voice replies when the voice runtime is configured",
      "Image, video, music, speech, and sticker generation through the configured media providers",
      "Web search, URL reading, translation, summarization, weather/news, and factual research",
      "Full website/app generation with planning, file-by-file progress, quality gates, build verification, repair, ZIP delivery, and preview-first Vercel deployment",
      "Real WhatsApp group administration: hidden mentions, tag-all, warnings, anti-link, welcome/leave controls, and permission-checked participant actions",
      "Reminders, recurring tasks, durable missions, project tracking, academy/LMS workflows, and owner-scoped Atlas project operations",
    ],
    conditional: [
      providerLabel,
      `${runtime.visionReady ? "visual analysis has a configured provider" : "visual analysis needs ZHIPU_API_KEY, GROQ_API_KEY, or OPENROUTER_API_KEY"}`,
      `${runtime.ytDlp.available ? `media download runtime ready (${runtime.ytDlp.version || "yt-dlp"})` : "media download runtime is unavailable until yt-dlp is installed"}`,
      `${runtime.vercelReady ? "Vercel deployment credential is configured" : "Vercel hosting needs VERCEL_TOKEN"}`,
      `${runtime.webReady ? "live web search is configured" : "live web search needs TAVILY_API_KEY or BRAVE_API_KEY"}`,
      ...(runtime.environment ? [
        `${runtime.environment.tools.git.healthy ? "Git is available" : "Git is unavailable"}`,
        `${runtime.environment.tools.ffmpeg.healthy ? "FFmpeg is available" : "FFmpeg is unavailable"}`,
        `${runtime.environment.tools.chromium.healthy ? "real browser verification is available" : "real browser unavailable; static verification fallback is available"}`,
      ] : []),
    ],
    boundaries: [
      "Do not claim real-time 3D game creation, arbitrary Cloudflare hosting, unrestricted downloads, or external actions unless the corresponding installed tool and credential actually exist.",
      "Do not claim to be conscious, biologically human, or secretly independent; expressive personality is not proof of subjective experience.",
      "Do not claim a website was deployed, a message was sent, or a file was changed unless the operation returned success.",
    ],
    runtime,
    source: ACTUAL_CAPABILITIES,
  };
}

function isCapabilityQuestion(text) {
  return /\b(?:what\s+can\s+you\s+do|what\s+do\s+you\s+do|what\s+are\s+your\s+capabilities|show\s+(?:me\s+)?your\s+capabilities|what\s+can\s+you\s+do\s+that|what\s+can\s+you\s+do\s+better|what\s+can\s+you\s+do\s+that\s+.+?\s+can'?t|difference\s+between\s+you\s+and|what\s+can\s+aria\s+do|axon)\b/i.test(String(text || ""));
}

function formatCapabilityReport() {
  const profile = getCapabilityProfile();
  return `⚔️ *ARIA capability check*\n\nI can’t inspect another assistant’s private implementation, so I won’t invent a fake one-to-one comparison. Here’s what I can actually do:\n\n${profile.immediate.map((item) => `• ${item}`).join("\n")}\n\n*Depends on deployment configuration:*\n${profile.conditional.map((item) => `• ${item}`).join("\n")}\n\n*I won’t bluff about:*\n${profile.boundaries.map((item) => `• ${item}`).join("\n")}\n\nMy strongest difference is not a flashy list—it’s the combination of memory, tools, permission checks, full coding workflows, visual/media understanding, and durable project execution in one companion.`;
}

function formatCapabilityContext() {
  const profile = getCapabilityProfile();
  return `\n\n[Verified ARIA capability profile]\nWhat ARIA can do now:\n${profile.immediate.map((item) => `- ${item}`).join("\n")}\n\nRuntime-dependent status:\n${profile.conditional.map((item) => `- ${item}`).join("\n")}\n\nComparison rules:\n${profile.boundaries.map((item) => `- ${item}`).join("\n")}\nWhen asked what ARIA can do that another bot cannot, compare only verified capabilities and say that the other bot's private implementation is unknown. Highlight ARIA's strongest practical differences: persistent memory, tool execution, full coding/build workflows, group administration, visual/media workflows, durable missions, and owner-scoped project operations.`;
}

module.exports = { getCapabilityProfile, isCapabilityQuestion, formatCapabilityReport, formatCapabilityContext, _test: { configured } };
