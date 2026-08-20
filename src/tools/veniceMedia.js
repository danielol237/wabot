const axios = require("axios");

const BASE_URL = String(process.env.VENICE_BASE_URL || "https://api.venice.ai/api/v1").replace(/\/+$/, "");
const API_KEY = String(process.env.VENICE_API_KEY || "").trim();
const IMAGE_MODEL = String(process.env.VENICE_IMAGE_MODEL || "venice-sd35").trim();
const DEFAULT_TIMEOUT = 180000;

function configured() {
  return Boolean(API_KEY);
}

function headers() {
  return { Authorization: `Bearer ${API_KEY}`, "Content-Type": "application/json", Accept: "application/json, image/*" };
}

function safeError(error) {
  const status = error?.response?.status;
  let detail = error?.message || "Venice image request failed";
  const raw = error?.response?.data;
  try {
    const parsed = Buffer.isBuffer(raw) ? JSON.parse(raw.toString("utf8")) : raw;
    detail = parsed?.error?.message || parsed?.message || parsed?.error || detail;
  } catch (_) {}
  return `${status ? `HTTP ${status}: ` : ""}${String(detail).slice(0, 500)}`;
}

function parsePayload(data) {
  if (!data) return {};
  if (Buffer.isBuffer(data)) {
    try { return JSON.parse(data.toString("utf8")); } catch (_) { return { buffer: data }; }
  }
  if (typeof data === "string") {
    try { return JSON.parse(data); } catch (_) { return { url: /^https?:\/\//i.test(data) ? data : "" }; }
  }
  return data;
}

function extractImage(payload) {
  if (Buffer.isBuffer(payload)) return { buffer: payload, mimetype: "image/png" };
  if (Buffer.isBuffer(payload?.buffer)) return { buffer: payload.buffer, mimetype: payload.mimetype || "image/png" };
  const roots = [payload, payload?.data, payload?.images, payload?.result].filter(Boolean);
  for (const root of roots) {
    const candidates = Array.isArray(root) ? root : [root];
    for (const item of candidates) {
      if (!item) continue;
      if (Buffer.isBuffer(item)) return { buffer: item, mimetype: "image/png" };
      const b64 = item.b64_json || item.base64 || item.image_base64 || item.image;
      if (typeof b64 === "string" && b64.length > 10) {
        const clean = b64.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, "");
        try { return { buffer: Buffer.from(clean, "base64"), mimetype: "image/png" }; } catch (_) {}
      }
      const url = item.url || item.image_url || item.imageUrl;
      if (/^https?:\/\//i.test(String(url || ""))) return { url: String(url) };
    }
  }
  return {};
}

async function generateImage(prompt, options = {}) {
  if (!configured()) return { success: false, provider: "venice", kind: "image", error: "Venice is not configured" };
  const body = {
    model: String(options.model || IMAGE_MODEL),
    prompt: String(prompt || "").slice(0, 7500),
    format: options.format || process.env.VENICE_IMAGE_FORMAT || "png",
    return_binary: true,
    safe_mode: options.safeMode !== undefined ? Boolean(options.safeMode) : process.env.VENICE_SAFE_MODE === "1",
  };
  if (options.aspectRatio || process.env.VENICE_IMAGE_ASPECT_RATIO) body.aspect_ratio = String(options.aspectRatio || process.env.VENICE_IMAGE_ASPECT_RATIO);
  else {
    body.width = Number(options.width || process.env.VENICE_IMAGE_WIDTH || 1024);
    body.height = Number(options.height || process.env.VENICE_IMAGE_HEIGHT || 1024);
  }
  if (options.negativePrompt || process.env.VENICE_NEGATIVE_PROMPT) body.negative_prompt = String(options.negativePrompt || process.env.VENICE_NEGATIVE_PROMPT).slice(0, 7500);

  try {
    const response = await axios.post(`${BASE_URL}/image/generate`, body, {
      headers: headers(),
      responseType: "arraybuffer",
      timeout: Number(options.timeoutMs || DEFAULT_TIMEOUT),
      maxContentLength: 25 * 1024 * 1024,
      maxBodyLength: 25 * 1024 * 1024,
      validateStatus: (status) => status >= 200 && status < 300,
    });
    const contentType = String(response.headers["content-type"] || "").split(";")[0].toLowerCase();
    if (contentType.startsWith("image/")) {
      const buffer = Buffer.from(response.data);
      if (!buffer.length) throw new Error("Venice returned an empty image");
      return { success: true, provider: "venice", kind: "image", buffer, mimetype: contentType };
    }
    const extracted = extractImage(parsePayload(response.data));
    if (extracted.buffer?.length || extracted.url) return { success: true, provider: "venice", kind: "image", ...extracted };
    throw new Error("Venice response did not contain an image or image URL");
  } catch (error) {
    return { success: false, provider: "venice", kind: "image", error: safeError(error) };
  }
}

module.exports = { configured, generateImage, _test: { parsePayload, extractImage, safeError } };
