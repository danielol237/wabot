const axios = require("axios");

const DEFAULT_BASE_URL = "https://api.minimax.io/v1";
const DEFAULT_IMAGE_MODEL = "image-01";
const DEFAULT_VIDEO_MODEL = "MiniMax-H3";
const DEFAULT_VOICE_MODEL = "speech-2.8-hd";
const DEFAULT_MUSIC_MODEL = "music-3.0-free";

function config(env = process.env) {
  const baseUrl = String(env.MINIMAX_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  return {
    apiKey: String(env.MINIMAX_API_KEY || "").trim(),
    baseUrl,
    videoBaseUrl: String(env.MINIMAX_VIDEO_BASE_URL || baseUrl.replace(/\/v1$/i, "/v2")).replace(/\/+$/, ""),
    imageModel: String(env.MINIMAX_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim(),
    videoModel: String(env.MINIMAX_VIDEO_MODEL || DEFAULT_VIDEO_MODEL).trim(),
    voiceModel: String(env.MINIMAX_VOICE_MODEL || DEFAULT_VOICE_MODEL).trim(),
    musicModel: String(env.MINIMAX_MUSIC_MODEL || DEFAULT_MUSIC_MODEL).trim(),
  };
}

function configured(env = process.env) {
  return Boolean(config(env).apiKey);
}

function headers(apiKey, contentType = true) {
  const result = { Authorization: `Bearer ${apiKey}` };
  if (contentType) result["Content-Type"] = "application/json";
  return result;
}

function safeError(error) {
  const status = error?.response?.status;
  const payload = error?.response?.data;
  const detail = typeof payload === "string"
    ? payload
    : payload?.base_resp?.status_msg || payload?.error?.message || payload?.message || error?.message;
  return `${status ? `HTTP ${status}: ` : ""}${String(detail || "MiniMax request failed").slice(0, 500)}`;
}

function requireKey(env = process.env) {
  const current = config(env);
  if (!current.apiKey) throw new Error("MiniMax media generation is not configured: add MINIMAX_API_KEY in Render.");
  return current;
}

async function post(url, body, current, options = {}) {
  try {
    const response = await axios.post(url, body, {
      headers: headers(current.apiKey),
      timeout: Number(options.timeout || 60000),
    });
    const base = response.data?.base_resp;
    if (base && Number(base.status_code) !== 0) throw new Error(base.status_msg || "MiniMax rejected the request");
    return response.data;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

async function get(url, current, options = {}) {
  try {
    const response = await axios.get(url, {
      headers: headers(current.apiKey, false),
      timeout: Number(options.timeout || 30000),
    });
    return response.data;
  } catch (error) {
    throw new Error(safeError(error));
  }
}

async function generateImage(prompt, options = {}) {
  try {
    const current = requireKey(options.env || process.env);
    const payload = await post(`${current.baseUrl}/image_generation`, {
      model: String(options.model || current.imageModel),
      prompt: String(prompt || "").slice(0, 1500),
      aspect_ratio: options.aspectRatio || process.env.MINIMAX_IMAGE_ASPECT_RATIO || "1:1",
      response_format: "url",
      n: Math.min(Math.max(Number(options.count) || 1, 1), 4),
      prompt_optimizer: options.promptOptimizer !== false,
    }, current, { timeout: 60000 });
    const urls = payload?.data?.image_urls || payload?.image_urls || [];
    const url = Array.isArray(urls) ? String(urls[0] || "") : String(urls || "");
    if (!/^https?:\/\//i.test(url)) throw new Error("MiniMax image response did not include an image URL.");
    return { success: true, provider: "minimax", kind: "image", url, urls, raw: payload };
  } catch (error) {
    return { success: false, provider: "minimax", kind: "image", error: error.message };
  }
}

async function generateVideo(prompt, options = {}) {
  try {
    const current = requireKey(options.env || process.env);
    const payload = await post(`${current.videoBaseUrl}/video_generation`, {
      model: String(options.model || current.videoModel),
      content: [{ type: "text", text: String(prompt || "").slice(0, 5000) }],
      resolution: options.resolution || process.env.MINIMAX_VIDEO_RESOLUTION || "768P",
      duration: Math.min(Math.max(Number(options.duration) || 5, 4), 15),
      ratio: options.ratio || process.env.MINIMAX_VIDEO_RATIO || "16:9",
    }, current, { timeout: 60000 });
    const taskId = payload?.task_id || payload?.task?.id;
    if (!taskId) throw new Error("MiniMax video response did not include a task ID.");

    const timeoutMs = Math.min(Math.max(Number(options.timeoutMs) || 600000, 30000), 900000);
    const pollMs = Math.min(Math.max(Number(options.pollMs) || 5000, 2000), 30000);
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const statusPayload = await get(`${current.videoBaseUrl}/query/video_generation/${encodeURIComponent(taskId)}`, current, { timeout: 30000 });
      const task = statusPayload?.task || statusPayload?.data?.task || statusPayload;
      const status = String(task?.status || "").toLowerCase();
      const url = String(task?.content?.url || task?.video_url || "");
      if (status === "succeeded" || /^https?:\/\//i.test(url)) {
        if (!/^https?:\/\//i.test(url)) throw new Error("MiniMax video completed without a video URL.");
        return { success: true, provider: "minimax", kind: "video", url, taskId, raw: statusPayload };
      }
      if (["failed", "error", "cancelled"].includes(status)) {
        throw new Error(String(task?.base_resp?.status_msg || task?.status_msg || "MiniMax video generation failed"));
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    throw new Error("MiniMax video generation timed out while waiting for the task.");
  } catch (error) {
    return { success: false, provider: "minimax", kind: "video", error: error.message };
  }
}

async function generateSpeech(text, options = {}) {
  try {
    const current = requireKey(options.env || process.env);
    const payload = await post(`${current.baseUrl}/t2a_v2`, {
      model: String(options.model || current.voiceModel),
      text: String(text || "").slice(0, 10000),
      stream: false,
      voice_setting: {
        voice_id: String(options.voiceId || process.env.MINIMAX_VOICE_ID || "English_expressive_narrator"),
        speed: Number(options.speed) || 1,
        vol: Number(options.volume) || 1,
        pitch: Number(options.pitch) || 0,
      },
      audio_setting: { sample_rate: 32000, bitrate: 128000, format: "mp3", channel: 1 },
      language_boost: "auto",
      output_format: "hex",
    }, current, { timeout: 90000 });
    const hex = payload?.data?.audio;
    if (typeof hex === "string" && hex.length) {
      return { success: true, provider: "minimax", kind: "speech", buffer: Buffer.from(hex, "hex"), mimetype: "audio/mpeg", raw: payload };
    }
    const url = payload?.data?.audio_url || payload?.audio_url;
    if (/^https?:\/\//i.test(String(url || ""))) return { success: true, provider: "minimax", kind: "speech", url: String(url), mimetype: "audio/mpeg", raw: payload };
    throw new Error("MiniMax speech response did not contain audio.");
  } catch (error) {
    return { success: false, provider: "minimax", kind: "speech", error: error.message };
  }
}

async function generateMusic(prompt, options = {}) {
  try {
    const current = requireKey(options.env || process.env);
    const lyrics = String(options.lyrics || "").slice(0, 3500);
    const instrumental = Boolean(options.instrumental);
    const payload = await post(`${current.baseUrl}/music_generation`, {
      model: String(options.model || current.musicModel),
      prompt: String(prompt || "").slice(0, 2000),
      lyrics,
      lyrics_optimizer: !lyrics && !instrumental,
      is_instrumental: instrumental,
      output_format: "hex",
      audio_setting: { sample_rate: 44100, bitrate: 256000, format: "mp3" },
    }, current, { timeout: 180000 });
    const hex = payload?.data?.audio;
    if (typeof hex === "string" && hex.length) {
      return { success: true, provider: "minimax", kind: "music", buffer: Buffer.from(hex, "hex"), mimetype: "audio/mpeg", raw: payload };
    }
    const url = payload?.data?.audio_url || payload?.audio_url;
    if (/^https?:\/\//i.test(String(url || ""))) return { success: true, provider: "minimax", kind: "music", url: String(url), mimetype: "audio/mpeg", raw: payload };
    throw new Error("MiniMax music response did not contain audio.");
  } catch (error) {
    return { success: false, provider: "minimax", kind: "music", error: error.message };
  }
}

module.exports = {
  config,
  configured,
  generateImage,
  generateVideo,
  generateSpeech,
  generateMusic,
  _test: { safeError },
};
