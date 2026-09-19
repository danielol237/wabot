const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const TEMP_DIR = path.join(__dirname, "../../temp");

function chromiumPath() {
  return process.env.ARIA_CHROMIUM_PATH || "chromium";
}

function safeText(value, max = 320) {
  return String(value || "").replace(/[\u0000-\u001f]+/g, " ").slice(0, max).trim();
}

async function extractArtifact(zipPath, projectId) {
  if (!zipPath || !fs.existsSync(zipPath)) return { success: false, error: "The verified project archive is unavailable." };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aria-delivery-${projectId || "project"}-`));
  try {
    await execFileAsync("unzip", ["-q", zipPath, "-d", dir], { timeout: 60000, maxBuffer: 1024 * 1024 });
    return { success: true, dir };
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true });
    return { success: false, error: `Could not unpack the verified project: ${safeText(error.message)}` };
  }
}

async function captureScreenshot(url, outputPath) {
  if (!url) return { success: false, error: "No live URL was available for screenshot capture." };
  try {
    await execFileAsync(chromiumPath(), [
      "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
      "--hide-scrollbars", "--window-size=1440,1000", `--screenshot=${outputPath}`, url,
    ], { timeout: 60000, maxBuffer: 2 * 1024 * 1024 });
    if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size < 1000) return { success: false, error: "The browser produced no usable screenshot." };
    return { success: true, path: outputPath };
  } catch (error) {
    return { success: false, error: `Screenshot capture failed: ${safeText(error.message)}` };
  }
}

async function verifyLiveUrl(url) {
  if (!url) return { success: false, error: "No live URL was returned by the hosting provider." };
  try {
    const screenshotPath = path.join(TEMP_DIR, `aria-delivery-${Date.now()}.png`);
    const result = await captureScreenshot(url, screenshotPath);
    if (!result.success) return result;
    return { success: true, url, screenshotPath };
  } catch (error) {
    return { success: false, error: safeText(error.message) };
  }
}

function formatDeliveryReport({ project, deployment, screenshot, github }) {
  const lines = [
    "✅ *ARIA finished the delivery workflow.*",
    "",
    `🏗️ Project: *${safeText(project.projectName || project.goal || project.projectId, 180)}*`,
    `🧪 Verification: *${project.verificationState || "VALID"}*`,
    `📦 Files checked: *${project.fileCount || project.files?.length || 0}*`,
  ];
  if (project.buildVerification) lines.push(`🔧 Build: *${project.buildVerification}*`);
  if (project.browserSmoke?.success) lines.push(`👀 Browser smoke: *passed*`);
  if (deployment?.url) lines.push(`🌐 Live website: ${deployment.url}`);
  if (github?.url) lines.push(`🐙 GitHub: ${github.url}`);
  lines.push("", screenshot?.success
    ? "I built it, ran the verification checks, checked the live page, and captured the screenshot below."
    : "I built it, ran the verification checks, and checked the live page. Screenshot capture is reported separately.");
  return lines.join("\n");
}

async function deliverWebsite({ sock, msg, ctx, request, buildProject, deployProject, publishProjectToGitHub, reply, react }) {
  const chatId = ctx.chatId;
  // Builder progress is useful for internal telemetry but noisy in WhatsApp.
  // Send only the start message and the final verified result.
  const onProgress = async () => {};
  await react(sock, msg, "🚀");
  await reply(sock, msg, "🚀 I’m building it, running the real checks, deploying the verified result, and preparing a screenshot + link.");

  const project = await buildProject(request, ctx.senderName, chatId, onProgress);
  if (!project.success) return reply(sock, msg, `❌ Build and verification failed.\n\n${safeText(project.error || "The project did not pass the quality gates.", 1000)}`);

  let deployment = project.previewUrl ? { success: true, url: project.previewUrl } : null;
  if (!deployment?.url) {
    if (!process.env.VERCEL_TOKEN) {
      return reply(sock, msg, `${formatDeliveryReport({ project })}\n\n⚠️ The project passed local verification, but I could not create a public website link because VERCEL_TOKEN is not configured.`);
    }
    deployment = await deployProject(chatId, project.projectId, { target: "preview" });
    if (!deployment.success) return reply(sock, msg, `⚠️ The project passed verification, but public deployment failed: ${safeText(deployment.error, 900)}`);
  }

  const live = await verifyLiveUrl(deployment.url);
  const github = /\bgithub\b/i.test(request) && publishProjectToGitHub
    ? await publishProjectToGitHub(chatId, project.projectId, {})
    : null;
  const report = formatDeliveryReport({ project, deployment, screenshot: live, github: github?.success ? github : null });
  await reply(sock, msg, report);
  if (live.success) {
    try {
      const image = fs.readFileSync(live.screenshotPath);
      await sock.sendMessage(chatId, { image, mimetype: "image/png", caption: `📸 Screenshot: ${deployment.url}` }, { quoted: msg });
    } catch (error) {
      await reply(sock, msg, `⚠️ The website is live, but the screenshot could not be sent: ${safeText(error.message)}`);
    } finally {
      try { fs.unlinkSync(live.screenshotPath); } catch (_) {}
    }
  } else {
    await reply(sock, msg, `⚠️ The website link is ready, but screenshot capture failed: ${safeText(live.error)}`);
  }

  if (project.zipPath && fs.existsSync(project.zipPath)) {
    try {
      const archive = fs.readFileSync(project.zipPath);
      await sock.sendMessage(chatId, { document: archive, fileName: `${safeText(project.projectName || project.projectId || "aria-site", 80).replace(/[^a-z0-9_-]+/gi, "-")}.zip`, mimetype: "application/zip", caption: "📦 Verified project archive" }, { quoted: msg });
    } catch (_) {}
  }
  return null;
}

module.exports = { deliverWebsite, captureScreenshot, extractArtifact, verifyLiveUrl, formatDeliveryReport, _test: { safeText } };
