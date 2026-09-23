const path = require("path");
const fs = require("fs");
const { getAIResponse } = require("./ai");
const capabilities = require("./whatsappCapabilities");

const ROOT = path.resolve(__dirname, "../..");
const ALLOWED = new Set(["send_file", "clone_website", "publish_status", "leave_group", "set_profile_picture", "audit_repository", "none"]);

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

async function decide(text, context = {}) {
  const request = clean(text, 1400);
  if (!request) return { capability: "none" };
  const prompt = `Classify the user's direct request into exactly one capability. Return JSON only: {"capability":"...","target":"...","caption":"..."}.
Allowed capabilities:
- send_file: send a local file, source archive, repository archive, or generated artifact into this chat
- clone_website: create a downloadable local snapshot of a public website and send it
- publish_status: publish text, an image, or a video to the bot's WhatsApp status
- leave_group: make the bot leave the current WhatsApp group
- set_profile_picture: change the bot's WhatsApp profile picture using the attached or quoted image
- audit_repository: inspect the user's connected private repository and explain its files and purpose
- none: ordinary conversation or a request that is not one of these operations
Never treat a hypothetical question as an action. Use target for a URL, repository name, file name, or requested description. Use caption only for status text.

Context: group=${Boolean(context.isGroup)}, attachedMedia=${Boolean(context.hasMedia)}, quotedText=${clean(context.quotedText, 600) || "none"}
User request: ${request}`;
  const response = await getAIResponse(prompt, "ARIA", [], "You are a strict action classifier. Return JSON only. Do not emit tool calls, XML, markdown, or explanations.");
  return parseDecision(response) || { capability: "none" };
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
  if (["leave_group", "publish_status", "set_profile_picture"].includes(decision.capability) && !require("../utils/permissions").isOwner(ctx.senderJid)) {
    return reply(sock, msg, "🔐 Only ARIA's owner can change her WhatsApp status, profile picture, or group membership.");
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
