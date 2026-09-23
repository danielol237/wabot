const path = require("path");
const fs = require("fs");
const { getAIResponse } = require("./ai");
const capabilities = require("./whatsappCapabilities");

const ROOT = path.resolve(__dirname, "../..");
const ALLOWED = new Set(["send_file", "clone_website", "build_and_host_website", "publish_status", "leave_group", "set_profile_picture", "audit_repository", "none"]);

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function parseDecision(value) {
  const text = String(value || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(text.slice(start, end + 1));
    return ALLOWED.has(parsed.capability) ? { capability: parsed.capability, target: clean(parsed.target, 700), caption: clean(parsed.caption, 500) } : null;
  } catch (_) { return null; }
}

// Safety fallback only: if all AI providers are unavailable, an attached
// identity-change request must not fall through to conversational AI.
function offlineMediaFallback(request, context) {
  const text = String(request || "").toLowerCase();
  if (context.hasMedia && /\b(?:profile|avatar|display)\b/.test(text) && /\b(?:picture|photo|image|pic)\b/.test(text) && /\b(?:change|set|update|use|make|switch)\b/.test(text)) {
    return { capability: "set_profile_picture", target: "", caption: "" };
  }
  if (/\b(?:leave|exit|quit)\b/.test(text) && /\b(?:group|gc|chat)\b/.test(text)) return { capability: "leave_group", target: "", caption: "" };
  if (/\b(?:status|story)\b/.test(text) && /\b(?:post|upload|publish|add|put|share|set|send)\b/.test(text)) return { capability: "publish_status", target: text, caption: text };
  if (/\b(?:clone|copy|scrape|mirror|snapshot)\b/.test(text) && /\b(?:website|site|webpage|url|link)\b/.test(text)) return { capability: "clone_website", target: text, caption: "" };
  if (/\b(?:build|rebuild|create|make|develop)\b/.test(text) && /\b(?:host|deploy|publish|online)\b/.test(text)) return { capability: "build_and_host_website", target: text, caption: "" };
  if (/\b(?:audit|inspect|review|explain|check)\b/.test(text) && /\b(?:repo|repository|codebase|github)\b/.test(text)) return { capability: "audit_repository", target: text, caption: "" };
  if (/\b(?:send|share|give)\b/.test(text) && /\b(?:file|zip|source|repo|repository|archive)\b/.test(text)) return { capability: "send_file", target: text, caption: "" };
  return { capability: "none" };
}

async function decide(text, context = {}) {
  const request = clean(text, 1400);
  if (!request) return { capability: "none" };
  const prompt = `Classify the user's direct request into exactly one capability. Return JSON only: {"capability":"...","target":"...","caption":"..."}.
Allowed capabilities:
- send_file: send a local file, source archive, repository archive, or generated artifact into this chat
- clone_website: create a downloadable local snapshot of a public website and send it
- build_and_host_website: use a public reference or user brief to build a new verified website, deploy it, and report the real URL; if deployment is unavailable, report that truthfully
- publish_status: publish text, an image, or a video to the bot's WhatsApp status
- leave_group: make the bot leave the current WhatsApp group
- set_profile_picture: change the bot's WhatsApp profile picture using the attached or quoted image
- audit_repository: inspect the user's connected private repository and explain its files and purpose
- none: ordinary conversation or a request that is not one of these operations
Never treat a hypothetical question as an action. Use target for a URL, repository name, file name, or requested description. Use caption only for status text.

Context: group=${Boolean(context.isGroup)}, attachedMedia=${Boolean(context.hasMedia)}, quotedText=${clean(context.quotedText, 600) || "none"}
User request: ${request}`;
  try {
    const response = await getAIResponse(prompt, "ARIA", [], "You are a strict action classifier. Return JSON only. Do not emit tool calls, XML, markdown, or explanations.");
    return parseDecision(response) || offlineMediaFallback(request, context);
  } catch (_) {
    return offlineMediaFallback(request, context);
  }
}

async function mediaFromMessage(sock, msg, helpers) {
  try {
    const current = await helpers.downloadMediaFromMsg(sock, msg);
    if (current?.buffer) return current;
  } catch (_) {}
  try {
    const quoted = await helpers.downloadQuotedMedia(sock, msg);
    if (quoted?.buffer) return quoted;
  } catch (_) {}
  return null;
}

async function execute(decision, { sock, msg, ctx, reply, quotedText = "" }) {
  const target = decision.target || "";
  if (decision.capability === "none") return false;
  if (["leave_group", "publish_status", "set_profile_picture", "build_and_host_website"].includes(decision.capability) && !require("../utils/permissions").isOwner(ctx.senderJid)) {
    return reply(sock, msg, "🔐 Only ARIA's owner can change her WhatsApp status, profile picture, group membership, or deploy a website.");
  }
  if (decision.capability === "leave_group") {
    if (!ctx.isGroup) return reply(sock, msg, "I can only leave the group I am currently inside.");
    await capabilities.leaveGroup(sock, ctx.chatId);
    return true;
  }
  if (decision.capability === "audit_repository") {
    const result = await require("./engineeringSystem").handleEngineeringRequest(`audit ${target || "my repository"}`, ctx.senderName, ctx.chatId, ctx.senderJid);
    await reply(sock, msg, result.message || (result.error ? `❌ ${result.error}` : "Repository audit completed."));
    return true;
  }
  if (decision.capability === "send_file") {
    let file = null;
    if (/\b(?:repo|repository|wabot|source)\b/i.test(target)) file = await capabilities.createRepositoryArchive(ROOT);
    else if (target && fs.existsSync(path.resolve(ROOT, target))) file = { path: path.resolve(ROOT, target), fileName: path.basename(target) };
    else if (target && capabilities.extractUrl(target)) file = await capabilities.snapshotWebsite(capabilities.extractUrl(target));
    if (!file) return reply(sock, msg, "I could not identify a safe local file or generated artifact to send.");
    await capabilities.sendDocument(sock, ctx.chatId, file, msg);
    return true;
  }
  if (decision.capability === "clone_website") {
    const url = capabilities.extractUrl(target) || capabilities.extractUrl(ctx.text);
    if (!url) return reply(sock, msg, "Send the public website link you want copied.");
    const file = await capabilities.snapshotWebsite(url);
    await capabilities.sendDocument(sock, ctx.chatId, { ...file, caption: `Website snapshot from ${url}` }, msg);
    return true;
  }
  if (decision.capability === "build_and_host_website") {
    const url = capabilities.extractUrl(target) || capabilities.extractUrl(ctx.text);
    const source = url
      ? `Build a new website informed by this public reference URL: ${url}. Preserve the useful visible structure and purpose, but do not claim to copy private or authenticated functionality. Original request: ${ctx.text}`
      : ctx.text;
    const router = require("../utils/commandRouter");
    if (typeof router.handleDeliver !== "function") return reply(sock, msg, "❌ The verified website delivery workflow is unavailable in this build.");
    await router.handleDeliver(sock, msg, source, ctx);
    return true;
  }
  if (decision.capability === "set_profile_picture") {
    const helpers = require("../utils/baileysHelpers");
    const media = await mediaFromMessage(sock, msg, helpers);
    if (!media?.buffer || !String(media.mimetype || "").startsWith("image/")) return reply(sock, msg, "Attach or reply to the image you want me to use as my profile picture.");
    await sock.updateProfilePicture(sock.user?.id?.split(":")[0] || sock.user?.id, media.buffer);
    return reply(sock, msg, "✅ My WhatsApp profile picture was updated.");
  }
  if (decision.capability === "publish_status") {
    const helpers = require("../utils/baileysHelpers");
    const media = await mediaFromMessage(sock, msg, helpers);
    if (media?.buffer) {
      const kind = String(media.mimetype || "").startsWith("video/") ? "video" : "image";
      await capabilities.publishStatus(sock, { kind, buffer: media.buffer, mimeType: media.mimetype }, decision.caption);
    } else if (target && capabilities.extractUrl(target)) {
      const asset = await capabilities.downloadPublicAsset(capabilities.extractUrl(target));
      const kind = asset.contentType.startsWith("video/") ? "video" : "image";
      await capabilities.publishStatus(sock, { kind, buffer: asset.buffer, mimeType: asset.contentType }, decision.caption);
    } else {
      await capabilities.publishStatus(sock, { kind: "text" }, decision.caption || target || quotedText);
    }
    return true;
  }
  return false;
}

module.exports = { decide, execute, _test: { parseDecision, ALLOWED } };
