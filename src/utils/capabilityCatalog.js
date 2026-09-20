const { execFileSync } = require("child_process");

const CAPABILITIES = Object.freeze([
  { name: "media.inspect_image", description: "Inspect incoming image or sticker bytes locally for format, dimensions, animation, alpha, and checksum.", inputSchema: { buffer: "Buffer", ocr: "boolean" }, outputSchema: { success: "boolean", format: "string|null", width: "number|null", height: "number|null", sha256: "string" }, requirements: ["Sharp runtime"], permissions: "conversation participant", limitations: ["metadata is local; semantic visual understanding still requires a multimodal model"] },
  { name: "media.convert_image", description: "Resize, crop, compress, and convert image bytes locally.", inputSchema: { buffer: "Buffer", format: "string", width: "number", height: "number" }, outputSchema: { success: "boolean", buffer: "Buffer", sha256: "string" }, requirements: ["Sharp runtime"], permissions: "conversation participant", limitations: ["does not invent or interpret image content"] },
  { name: "media.transcode", description: "Convert audio and video locally with FFmpeg.", inputSchema: { buffer: "Buffer", audioOnly: "boolean", videoOnly: "boolean", extension: "string" }, outputSchema: { success: "boolean", buffer: "Buffer", sha256: "string" }, requirements: ["FFmpeg executable"], permissions: "conversation participant", limitations: ["codec support follows the installed FFmpeg build"] },
  { name: "speech.synthesize_local", description: "Generate speech locally with an installed system speech synthesizer.", inputSchema: { text: "string", voice: "string" }, outputSchema: { success: "boolean", buffer: "Buffer", mimetype: "string" }, requirements: ["espeak, espeak-ng, or pico2wave"], permissions: "conversation participant", limitations: ["voice quality and language coverage follow the installed runtime"] },
  { name: "whatsapp.send_media", description: "Send a verified image, sticker, audio, video, or document through the active WhatsApp socket.", inputSchema: { chatId: "string", buffer: "Buffer", mediaType: "string" }, outputSchema: { success: "boolean", messageId: "string|null" }, requirements: ["active WhatsApp socket"], permissions: "explicit user request and recipient scope", limitations: ["delivery confirmation depends on the WhatsApp socket"] },
  { name: "connectors.discover", description: "List configured native tools and external connectors from the actual runtime registry.", inputSchema: { query: "string" }, outputSchema: { tools: "array", connectors: "array" }, requirements: ["runtime inspection"], permissions: "conversation participant", limitations: ["not configured does not mean authenticated"] },
  { name: "memory.write", description: "Persist a user-provided fact or preference for later retrieval.", inputSchema: { userId: "string", value: "string" }, outputSchema: { persisted: "boolean", recordCount: "number" }, requirements: ["persistent profile storage"], permissions: "conversation participant", limitations: ["bounded per-user storage"] },
  { name: "memory.read", description: "Read persisted memories and profile facts for a user.", inputSchema: { userId: "string" }, outputSchema: { memories: "array", profile: "object" }, requirements: ["persistent profile storage"], permissions: "conversation participant", limitations: ["returns stored records only"] },
  { name: "project.build", description: "Plan, generate, cross-check, validate, test, and package a project.", inputSchema: { chatId: "string", goal: "string" }, outputSchema: { success: "boolean", projectId: "string", validation: "object", task: "object" }, requirements: ["coding provider", "filesystem workspace"], permissions: "owner for bot engineering operations", limitations: ["runtime checks depend on installed tools"] },
  { name: "project.deploy", description: "Deploy a verified project using an available hosting provider and verify its URL.", inputSchema: { projectId: "string", target: "string" }, outputSchema: { success: "boolean", url: "string|null", verified: "boolean" }, requirements: ["verified project", "hosting credentials"], permissions: "owner approval", limitations: ["no URL is reported unless deployment and verification succeed"] },
  { name: "project.deliver", description: "Build, verify, deploy, screenshot, and send a completed website with its live link and archive.", inputSchema: { chatId: "string", goal: "string" }, outputSchema: { success: "boolean", url: "string|null", screenshot: "boolean", archive: "boolean" }, requirements: ["coding provider", "filesystem workspace", "hosting credentials"], permissions: "owner approval", limitations: ["public link requires a configured hosting provider"] },
  { name: "engineering.inspect", description: "Inspect an allowlisted repository and produce a bounded, reviewable change plan.", inputSchema: { objective: "string", repository: "string" }, outputSchema: { success: "boolean", proposal: "object|null" }, requirements: ["repository access for private repositories"], permissions: "repository owner", limitations: ["never writes directly to main"] },
]);

function listCapabilities(filter = {}) {
  const requested = String(filter.category || "").trim().toLowerCase();
  return CAPABILITIES.filter((capability) => !requested || capability.name.startsWith(`${requested}.`)).map((capability) => ({ ...capability, inputSchema: { ...capability.inputSchema }, outputSchema: { ...capability.outputSchema }, requirements: [...capability.requirements], limitations: [...capability.limitations] }));
}
function getCapability(name) { return listCapabilities().find((capability) => capability.name === String(name || "").trim()) || null; }
function commandStatus(command) {
  try { return { available: true, path: execFileSync("sh", ["-lc", `command -v ${command}`], { encoding: "utf8", timeout: 2000 }).trim() }; }
  catch (_) { return { available: false, path: null }; }
}
function envStatus(name, capabilities = []) {
  const configured = Boolean(String(process.env[name] || "").trim());
  return { name, type: "connector", configured, authenticated: configured, healthy: configured, capabilities, permissions: configured ? "configured credential" : "not configured", last_checked: new Date().toISOString() };
}
function inspectEnvironment() {
  const git = commandStatus("git");
  const ffmpeg = commandStatus("ffmpeg");
  const ytDlp = commandStatus("yt-dlp");
  const chromium = commandStatus("chromium");
  let nativeMedia = null;
  try { nativeMedia = require("../tools/nativeMedia").inspectLocalRuntimes(); } catch (_) {}
  let github = envStatus("GITHUB_TOKEN", ["repository inspection", "branch and pull-request workflows"]);
  try {
    const status = require("../tools/githubCredentialVault").status();
    github = { ...github, configured: Boolean(status?.configured || github.configured), authenticated: Boolean(status?.configured || github.authenticated), healthy: Boolean(status?.configured || github.healthy), source: status?.source || (github.configured ? "environment" : null), last_checked: new Date().toISOString() };
  } catch (_) {}
  const connectors = [
    github,
    envStatus("VERCEL_TOKEN", ["preview and production deployment"]),
    envStatus("SUPABASE_URL", ["persistent profile and project memory"]),
    envStatus("COMPANION_API_KEY", ["Android companion authentication"]),
  ];
  return {
    checkedAt: new Date().toISOString(),
    tools: {
      git: { ...git, healthy: git.available, capabilities: ["repository inspection", "version control"] },
      ffmpeg: { ...ffmpeg, healthy: ffmpeg.available, capabilities: ["audio and video processing"] },
      ytDlp: { ...ytDlp, healthy: ytDlp.available, capabilities: ["public media download"] },
      chromium: { ...chromium, healthy: chromium.available, capabilities: ["real browser smoke verification"] },
      nativeMedia: nativeMedia || { sharp: false, ffmpeg: ffmpeg.available, ffprobe: false, tesseract: false, espeak: false },
    },
    connectors,
    storage: { filesystem: true, projectMemory: true, database: Boolean(process.env.SUPABASE_URL && (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY)) },
  };
}
function operationResult({ capability, state, output = null, error = null, evidence = [] } = {}) {
  const validStates = new Set(["PLANNED", "IN_PROGRESS", "WAITING_FOR_INPUT", "WAITING_FOR_PERMISSION", "SUCCEEDED", "FAILED", "PARTIALLY_SUCCEEDED"]);
  const normalizedState = validStates.has(state) ? state : "FAILED";
  return Object.freeze({ capability: String(capability || "unknown"), state: normalizedState, output, error: error ? String(error) : null, evidence: Array.isArray(evidence) ? evidence.slice(0, 20) : [] });
}
module.exports = { CAPABILITIES, listCapabilities, getCapability, inspectEnvironment, operationResult };
