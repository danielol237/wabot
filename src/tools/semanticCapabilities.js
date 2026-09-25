const path = require("path");
const fs = require("fs");
const { getAIResponse } = require("./ai");
const capabilities = require("./whatsappCapabilities");
const mcpRegistry = require("./mcpServers");
const macalyCloud = require("./macalyCloud");

const ROOT = path.resolve(__dirname, "../..");
const ALLOWED = new Set(["send_file", "clone_website", "build_and_host_website", "publish_status", "leave_group", "set_profile_picture", "github_engineering", "list_capabilities", "use_connected_tool", "connect_app", "macaly", "none"]);

function isSafeSendFile(targetPath) {
  if (!targetPath) return false;
  const resolved = path.resolve(ROOT, targetPath);
  if (!resolved.startsWith(ROOT + path.sep) && resolved !== ROOT) return false;
  const relative = path.relative(ROOT, resolved);
  if (!relative) return false;
  if (/^(?:\.env|\.git|data|node_modules|temp)(?:$|[/\\])/i.test(relative)) return false;
  if (/\.(?:key|enc|pem|crt|db|sqlite|log|json|env)$/i.test(relative) && relative !== "package.json") return false;
  if (/credential|session|token|secret|vault/i.test(relative)) return false;
  return true;
}
const MAX_TOOLS_IN_PROMPT = 40;

function clean(value, max = 500) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

// liveTools is passed in (not re-fetched) so parsing always validates against
// the exact list the model was actually shown this round — never a stale or
// hypothetical one.
function parseDecision(value, liveTools = []) {
  const text = String(value || "").replace(/```json|```/gi, "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed;
  try { parsed = JSON.parse(text.slice(start, end + 1)); } catch (_) { return null; }
  if (!ALLOWED.has(parsed.capability)) return null;
  if (parsed.capability === "use_connected_tool") {
    // Never call a tool the model merely claims exists — only dispatch when
    // the name matches something tools/list actually returned this round.
    const match = liveTools.find((tool) => tool.name === parsed.tool && (!parsed.server || tool.server === parsed.server));
    if (!match) return null;
    const args = parsed.arguments && typeof parsed.arguments === "object" && !Array.isArray(parsed.arguments) ? parsed.arguments : {};
    return { capability: "use_connected_tool", server: match.server, tool: match.name, arguments: args, target: clean(parsed.target, 700) };
  }
  return { capability: parsed.capability, target: clean(parsed.target, 700), caption: clean(parsed.caption, 500) };
}

// Safety fallback only: if all AI providers are unavailable, an attached
// identity-change request must not fall through to conversational AI. This
// never sees live MCP tools (it has no model call to describe them to), so
// it only ever recognizes the fixed built-in actions — by design, a narrower
// net than the AI path above, not a replacement for it.
function offlineMediaFallback(request, context) {
  const text = String(request || "").toLowerCase();
  if (context.hasMedia && /\b(?:profile|avatar|display)\b/.test(text) && /\b(?:picture|photo|image|pic)\b/.test(text) && /\b(?:change|set|update|use|make|switch)\b/.test(text)) {
    return { capability: "set_profile_picture", target: "", caption: "" };
  }
  if (/\b(?:leave|exit|quit)\b/.test(text) && /\b(?:group|gc|chat)\b/.test(text)) return { capability: "leave_group", target: "", caption: "" };
  if (/\b(?:status|story)\b/.test(text) && /\b(?:post|upload|publish|add|put|share|set|send)\b/.test(text)) return { capability: "publish_status", target: text, caption: text };
  if (/\b(?:clone|copy|scrape|mirror|snapshot)\b/.test(text) && /\b(?:website|site|webpage|url|link)\b/.test(text)) return { capability: "clone_website", target: text, caption: "" };
  if (/\b(?:build|rebuild|create|make|develop)\b/.test(text) && /\b(?:host|deploy|publish|online)\b/.test(text)) return { capability: "build_and_host_website", target: text, caption: "" };
  if (/\b(?:audit|inspect|review|explain|check|plan|approve|verify|merge)\b/.test(text) && /\b(?:repo|repository|codebase|github|upgrade)\b/.test(text)) return { capability: "github_engineering", target: text, caption: "" };
  if (/\b(?:send|share|give)\b/.test(text) && /\b(?:file|zip|source|repo|repository|archive)\b/.test(text)) return { capability: "send_file", target: text, caption: "" };
  if (/\b(?:what|which)\b.*\b(?:can you|are you able|do you)\b/.test(text) || /\byour\s+(?:capabilities|tools|skills|abilities)\b/.test(text)) return { capability: "list_capabilities", target: "", caption: "" };
  return { capability: "none" };
}

async function decide(text, context = {}) {
  const request = clean(text, 1400);
  if (!request) return { capability: "none" };
  // Composio tools are per-user (each WhatsApp user's own connected
  // accounts, the same per-individual model githubOAuth.js already uses for
  // GitHub) — so the live tool list depends on WHO is asking, not just
  // whether Composio is configured at all.
  const actorJid = context.senderJid || "";
  let liveTools = [];
  if (actorJid) { try { liveTools = await mcpRegistry.listAllTools(actorJid); } catch (_) {} }
  const toolLines = liveTools.slice(0, MAX_TOOLS_IN_PROMPT).map((tool) => `- ${tool.server}.${tool.name}: ${clean(tool.description, 140)}`).join("\n");
  const toolSection = liveTools.length
    ? `\n\nThis user's own live connected tools — use capability "use_connected_tool" with the exact "server" and "tool" values shown, plus an "arguments" object matching what that tool needs, whenever one of these genuinely fits the request better than the fixed capabilities above (never invent a server/tool name that isn't listed here):\n${toolLines}${liveTools.length > MAX_TOOLS_IN_PROMPT ? `\n(+${liveTools.length - MAX_TOOLS_IN_PROMPT} more not shown this round)` : ""}`
    : "";
  const prompt = `Classify the user's direct request into exactly one capability. Return JSON only: {"capability":"...","target":"...","caption":"...","server":"...","tool":"...","arguments":{}}.
Allowed capabilities:
- send_file: send a local file, source archive, repository archive, or generated artifact into this chat
- clone_website: create a downloadable local snapshot of a public website and send it
- build_and_host_website: use a public reference or user brief to build a new verified website, deploy it, and report the real URL; if deployment is unavailable, report that truthfully
- publish_status: publish text, an image, or a video to the bot's WhatsApp status
- leave_group: make the bot leave the current WhatsApp group
- set_profile_picture: change the bot's WhatsApp profile picture using the attached or quoted image
- github_engineering: anything about the user's connected GitHub repository or ARIA's engineering system — auditing/reviewing/explaining a repo, listing repos, switching the active repo, planning/proposing/building a code change, or approving/verifying/merging a pending upgrade
- list_capabilities: the user is asking what you can do, or asking you to list your tools/abilities
- connect_app: the user wants to connect/link/authorize a specific outside app or service (Gmail, Slack, Notion, Calendar, etc., BUT NOT Macaly) to their own account with ARIA — put the app/service name in target
${macalyCloud.CLASSIFIER_LINE}
- use_connected_tool: the request is best served by one of this user's own live connected tools listed below
- none: ordinary conversation or a request that is not one of these operations
Never treat a hypothetical question as an action. Use target for a URL, repository name, upgrade id, file/app/service name, or the request itself when relevant. Use caption only for status text. Only use a "server"/"tool" pair that appears verbatim in the live tools list below — never invent one.

Context: group=${Boolean(context.isGroup)}, attachedMedia=${Boolean(context.hasMedia)}, quotedText=${clean(context.quotedText, 600) || "none"}
User request: ${request}${toolSection}`;
  try {
    const response = await getAIResponse(prompt, "ARIA", [], "You are a strict action classifier. Return JSON only. Do not emit tool calls, XML, markdown, or explanations.");
    return parseDecision(response, liveTools) || offlineMediaFallback(request, context);
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

// Built fresh each call (not hardcoded prose) so it always reflects what's
// actually wired up right now for THIS user specifically — Composio tools
// are per-user, so what shows here depends on what actorJid has connected,
// the same way one person's GitHub token never shows up for another.
async function describeCapabilities(actorJid) {
  const liveTools = actorJid ? await mcpRegistry.listAllTools(actorJid).catch(() => []) : [];
  const byServer = {};
  for (const tool of liveTools) (byServer[tool.server] = byServer[tool.server] || []).push(tool.name);
  const connectedLines = Object.entries(byServer)
    .map(([server, names]) => `• *${server}*: ${names.slice(0, 12).join(", ")}${names.length > 12 ? ` (+${names.length - 12} more)` : ""}`)
    .join("\n");
  const composioHint = mcpRegistry.isConfigured()
    ? (connectedLines ? `Your connected tools (live, via Composio):\n${connectedLines}` : "Composio is available, but you have not connected any apps yet — say something like \"connect my Gmail\" and I'll send you a link.")
    : "No external app connections (Composio) are set up on this bot yet.";
  return `🧩 *What I can actually do for you right now*\n\nBuilt in: send files, snapshot/clone a public website, build + host a new website, post to WhatsApp status, leave a group, change my profile picture, work with your connected GitHub repo (audit, plan, approve, verify, merge upgrades), and work in your own Macaly Cloud account (create, inspect, change, preview, deploy apps or link/unlink Macaly) — that's your own GitHub and Macaly, connected with your own links, never shared with anyone else.\n\n${composioHint}\n\nJust ask in plain language — I'll work out which of these fits, you don't need exact phrasing or a command.`;
}

async function execute(decision, { sock, msg, ctx, reply, quotedText = "" }) {
  const target = decision.target || "";
  const actorJid = ctx.senderJid;
  if (decision.capability === "none") return false;
  if (decision.capability === "macaly") {
    const rawText = String(ctx?.text || decision?.target || "").toLowerCase();
    if (!/\bmacaly\b/i.test(rawText)) {
      return false; // Fall back if Macaly was selected without explicit service mention
    }
    await macalyCloud.handleRequest({ request: ctx.text || decision.target, quotedText, actorJid: ctx.senderJid, sock, msg, reply });
    return true;
  }
  // Composio tools and connections are per-user (this user's own connected
  // accounts, looked up by their own actorJid) — NOT blanket owner-gated,
  // the same reasoning github_engineering below already uses. The bot-wide
  // actions (status, pfp, group membership, deploying a shared website)
  // stay owner-only because they affect ARIA's one shared WhatsApp identity.
  if (["leave_group", "publish_status", "set_profile_picture", "build_and_host_website"].includes(decision.capability) && !require("../utils/permissions").isOwner(actorJid)) {
    return reply(sock, msg, "🔐 Only ARIA's owner can change her WhatsApp status, profile picture, group membership, or deploy a shared website.");
  }
  if (decision.capability === "leave_group") {
    if (!ctx.isGroup) return reply(sock, msg, "I can only leave the group I am currently inside.");
    await capabilities.leaveGroup(sock, ctx.chatId);
    return true;
  }
  if (decision.capability === "list_capabilities") {
    return reply(sock, msg, await describeCapabilities(actorJid));
  }
  if (decision.capability === "connect_app") {
    if (!mcpRegistry.isConfigured()) return reply(sock, msg, "❌ External app connections (Composio) aren't set up on this bot yet.");
    if (!target) return reply(sock, msg, "Which app do you want to connect — e.g. \"connect my Gmail\"?");
    try {
      const linkMessage = await mcpRegistry.requestConnectLink(actorJid, target);
      return reply(sock, msg, `🔗 ${linkMessage}`);
    } catch (error) {
      return reply(sock, msg, `❌ I couldn't start connecting ${target}: ${clean(error.message, 300)}`);
    }
  }
  if (decision.capability === "use_connected_tool") {
    try {
      const result = await mcpRegistry.callTool(actorJid, decision.server, decision.tool, decision.arguments || {});
      if (result.isError) return reply(sock, msg, `❌ ${decision.server}.${decision.tool} reported an error: ${result.text || "no details given"}`);
      return reply(sock, msg, result.text || `✅ ${decision.tool} ran, but returned no readable output.`);
    } catch (error) {
      return reply(sock, msg, `❌ I couldn't reach ${decision.server}.${decision.tool}: ${clean(error.message, 300)}`);
    }
  }
  if (decision.capability === "github_engineering") {
    const codingSubsystem = require("../coding");
    const initRes = await codingSubsystem.handleCodingRequest(target || "audit my repository", {
      userId: ctx.senderJid,
      chatId: ctx.chatId,
    });
    await reply(sock, msg, initRes.message);
    codingSubsystem.engine.taskManager.once(`task.completed`, (evt) => {
      if (evt.taskId === initRes.taskId) {
        const finalReport = codingSubsystem.getTaskResult(evt.taskId);
        reply(sock, msg, finalReport).catch(() => {});
      }
    });
    codingSubsystem.engine.taskManager.once(`task.failed`, (evt) => {
      if (evt.taskId === initRes.taskId) {
        const finalReport = codingSubsystem.getTaskResult(evt.taskId);
        reply(sock, msg, finalReport).catch(() => {});
      }
    });
    return true;
  }
  if (decision.capability === "send_file") {
    let file = null;
    if (/\b(?:repo|repository|wabot|source)\b/i.test(target)) file = await capabilities.createRepositoryArchive(ROOT);
    else if (target && fs.existsSync(path.resolve(ROOT, target))) {
      if (!isSafeSendFile(target)) return reply(sock, msg, "🔐 Access to that path or sensitive configuration file is restricted for security.");
      file = { path: path.resolve(ROOT, target), fileName: path.basename(target) };
    }
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

module.exports = { decide, execute, describeCapabilities, _test: { parseDecision, ALLOWED } };
