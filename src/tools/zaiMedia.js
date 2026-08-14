const axios = require("axios");

const BASE_URL = String(process.env.ZHIPU_BASE_URL || "https://api.z.ai/api/paas/v4").replace(/\/+$/, "");
const API_KEY = String(process.env.ZHIPU_API_KEY || "").trim();
const IMAGE_MODEL = String(process.env.ZHIPU_IMAGE_MODEL || "glm-image").trim();
const VIDEO_MODEL = String(process.env.ZHIPU_VIDEO_MODEL || "cogvideox-3").trim();
const VISION_MODEL = String(process.env.ZHIPU_VISION_MODEL || "glm-4.6v-flash").trim();
const DEFAULT_USER = String(process.env.ZHIPU_USER_ID || "aria-server").slice(0, 128).padEnd(6, "0");
const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_POLL_MS = 4000;

function configured() {
  return Boolean(API_KEY);
}

function headers() {
  return {
    Authorization: `Bearer ${API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

function safeError(error) {
  const status = error?.response?.status;
  const payload = error?.response?.data;
  const detail = typeof payload === "string" ? payload : payload?.message || payload?.error?.message || error?.message;
  return `${status ? `HTTP ${status}: ` : ""}${String(detail || "Z.AI request failed").slice(0, 500)}`;
}

function required() {
  if (!configured()) throw new Error("Z.AI media provider is not configured. Add ZHIPU_API_KEY on the server.");
}

function userId(value) {
  const clean = String(value || DEFAULT_USER).replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 128);
  return clean.length >= 6 ? clean : `${clean}000000`.slice(0, 6);
}

function taskId(payload) {
  return payload?.id || payload?.task_id || payload?.data?.id || payload?.data?.task_id || payload?.task?.id || payload?.task?.task_id || "";
}

function statusOf(payload) {
  return String(payload?.status || payload?.data?.status || payload?.task_status || payload?.data?.task_status || "").toUpperCase();
}

function resultUrl(payload, kind) {
  const roots = [payload, payload?.data, payload?.result, payload?.data?.result].filter(Boolean);
  for (const root of roots) {
    const candidates = kind === "video"
      ? [root.video_result?.url, root.video_result?.[0]?.url, root.url, root.video_url]
      : [root.image_result?.url, root.image_result?.[0]?.url, root.images?.[0]?.url, root.url];
    const found = candidates.find((value) => /^https?:\/\//i.test(String(value || "")));
    if (found) return String(found);
  }
  return "";
}

async function post(pathname, body) {
  required();
  try {
    const response = await axios.post(`${BASE_URL}${pathname}`, body, { headers: headers(), timeout: 45000 });
    return response.data;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

async function get(pathname) {
  required();
  try {
    const response = await axios.get(`${BASE_URL}${pathname}`, { headers: headers(), timeout: 30000 });
    return response.data;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

async function waitForTask(id, kind, options = {}) {
  const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS, 10000), 600000);
  const pollMs = Math.min(Math.max(Number(options.pollMs) || DEFAULT_POLL_MS, 1000), 30000);
  const started = Date.now();
  let latest = null;
  while (Date.now() - started < timeoutMs) {
    latest = await get(`/async-result/${encodeURIComponent(id)}`);
    const status = statusOf(latest);
    if (status === "SUCCESS" || resultUrl(latest, kind)) {
      return { success: true, taskId: id, url: resultUrl(latest, kind), raw: latest };
    }
    if (status === "FAIL" || status === "FAILED" || status === "ERROR") {
      throw new Error(String(latest?.message || latest?.error?.message || `${kind} generation failed`));
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  throw new Error(`${kind} generation timed out after ${Math.round(timeoutMs / 1000)} seconds`);
}

async function generateImage(prompt, options = {}) {
  try {
    const payload = await post("/images/generations", {
      model: String(options.model || IMAGE_MODEL),
      prompt: String(prompt || "").slice(0, 5000),
      quality: options.quality || process.env.ZHIPU_IMAGE_QUALITY || "hd",
      size: options.size || process.env.ZHIPU_IMAGE_SIZE || "1280x1280",
      user_id: userId(options.userId),
    });
    const id = taskId(payload);
    const direct = resultUrl(payload, "image");
    if (direct) return { success: true, provider: "zai", kind: "image", url: direct, taskId: id || null, raw: payload };
    if (!id) throw new Error("Z.AI image response did not include a task ID or image URL");
    return { provider: "zai", kind: "image", ...await waitForTask(id, "image", options) };
  } catch (error) {
    return { success: false, provider: "zai", kind: "image", error: error.message };
  }
}

async function generateVideo(prompt, options = {}) {
  try {
    const body = {
      model: String(options.model || VIDEO_MODEL),
      prompt: String(prompt || "").slice(0, 512),
      quality: options.quality || process.env.ZHIPU_VIDEO_QUALITY || "speed",
      with_audio: Boolean(options.withAudio),
      size: options.size || process.env.ZHIPU_VIDEO_SIZE || "1280x720",
      fps: Number(options.fps) === 60 ? 60 : 30,
      duration: Number(options.duration) === 10 ? 10 : 5,
      request_id: `aria-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      user_id: userId(options.userId),
    };
    if (options.imageUrl) body.image_url = String(options.imageUrl);
    if (Array.isArray(options.imageUrls) && options.imageUrls.length) body.image_url = options.imageUrls.slice(0, 2).map(String);
    const payload = await post("/videos/generations", body);
    const id = taskId(payload);
    if (!id) throw new Error("Z.AI video response did not include a task ID");
    return { provider: "zai", kind: "video", ...await waitForTask(id, "video", options) };
  } catch (error) {
    return { success: false, provider: "zai", kind: "video", error: error.message };
  }
}

async function analyzeImage(base64Image, mimeType = "image/jpeg", question = "Describe this image and explain what is happening.", options = {}) {
  try {
    required();
    const payload = await post("/chat/completions", {
      model: String(options.model || VISION_MODEL),
      messages: [{
        role: "user",
        content: [
          { type: "text", text: String(question).slice(0, 8000) },
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        ],
      }],
      max_tokens: Math.min(Math.max(Number(options.maxTokens) || 1536, 128), 4096),
      user_id: userId(options.userId),
    });
    const text = payload?.choices?.[0]?.message?.content || payload?.data?.choices?.[0]?.message?.content || "";
    if (!text) throw new Error("Z.AI vision response was empty");
    return { success: true, provider: "zai", kind: "vision", text: String(text), raw: payload };
  } catch (error) {
    return { success: false, provider: "zai", kind: "vision", error: error.message };
  }
}

module.exports = {
  configured,
  generateImage,
  generateVideo,
  analyzeImage,
};
