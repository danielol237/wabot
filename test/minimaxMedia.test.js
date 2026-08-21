const test = require("node:test");
const assert = require("node:assert/strict");
const axios = require("axios");
const media = require("../src/tools/minimaxMedia");

function restore(target, key, value) {
  target[key] = value;
}

test("minimax media: reports missing key without making a request", async () => {
  const result = await media.generateImage("a dog", { env: { MINIMAX_API_KEY: "" } });
  assert.equal(result.success, false);
  assert.match(result.error, /MINIMAX_API_KEY/);
});

test("minimax media: generates an image from the exact prompt", async () => {
  const originalPost = axios.post;
  let request;
  axios.post = async (url, body, options) => {
    request = { url, body, options };
    return { data: { data: { image_urls: ["https://cdn.example/image.png"] }, base_resp: { status_code: 0 } } };
  };
  try {
    const result = await media.generateImage("a cinematic dog on the beach", {
      env: { MINIMAX_API_KEY: "test-key", MINIMAX_BASE_URL: "https://api.example/v1" },
    });
    assert.equal(result.success, true);
    assert.equal(result.url, "https://cdn.example/image.png");
    assert.equal(request.url, "https://api.example/v1/image_generation");
    assert.equal(request.body.prompt, "a cinematic dog on the beach");
    assert.equal(request.options.headers.Authorization, "Bearer test-key");
  } finally {
    restore(axios, "post", originalPost);
  }
});

test("minimax media: creates and polls an H3 video task", async () => {
  const originalPost = axios.post;
  const originalGet = axios.get;
  let createRequest;
  axios.post = async (url, body) => {
    createRequest = { url, body };
    return { data: { task_id: "task-123" } };
  };
  axios.get = async (url) => ({ data: { task: { id: "task-123", status: "succeeded", content: { url: "https://cdn.example/video.mp4" } } } });
  try {
    const result = await media.generateVideo("a dog running on the beach", {
      env: { MINIMAX_API_KEY: "test-key", MINIMAX_BASE_URL: "https://api.example/v1" },
      pollMs: 2000,
      timeoutMs: 10000,
    });
    assert.equal(result.success, true);
    assert.equal(result.url, "https://cdn.example/video.mp4");
    assert.equal(createRequest.url, "https://api.example/v2/video_generation");
    assert.equal(createRequest.body.content[0].text, "a dog running on the beach");
    assert.equal(createRequest.body.model, "MiniMax-H3");
  } finally {
    restore(axios, "post", originalPost);
    restore(axios, "get", originalGet);
  }
});

test("minimax media: converts speech and music hex responses to audio buffers", async () => {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (url, body) => {
    calls.push({ url, body });
    return { data: { data: { audio: "6869" }, base_resp: { status_code: 0 } } };
  };
  try {
    const env = { MINIMAX_API_KEY: "test-key", MINIMAX_BASE_URL: "https://api.example/v1" };
    const speech = await media.generateSpeech("hello ARIA", { env });
    const music = await media.generateMusic("dark afrobeats for a night drive", { env });
    assert.equal(speech.success, true);
    assert.equal(speech.buffer.toString(), "hi");
    assert.equal(music.success, true);
    assert.equal(music.buffer.toString(), "hi");
    assert.equal(calls[0].url, "https://api.example/v1/t2a_v2");
    assert.equal(calls[0].body.text, "hello ARIA");
    assert.equal(calls[1].url, "https://api.example/v1/music_generation");
    assert.equal(calls[1].body.prompt, "dark afrobeats for a night drive");
    assert.equal(calls[1].body.model, "music-3.0");
  } finally {
    restore(axios, "post", originalPost);
  }
});


test("minimax media: retries music with the configured fallback model", async () => {
  const originalPost = axios.post;
  const calls = [];
  axios.post = async (url, body) => {
    calls.push({ url, body });
    if (body.model === "music-3.0") {
      const error = new Error("primary model unavailable");
      error.response = { status: 404, data: { base_resp: { status_msg: "model not found" } } };
      throw error;
    }
    return { data: { data: { audio: "6869" }, base_resp: { status_code: 0 } } };
  };
  try {
    const result = await media.generateMusic("fallback test", {
      env: { MINIMAX_API_KEY: "test-key", MINIMAX_BASE_URL: "https://api.example/v1" },
    });
    assert.equal(result.success, true);
    assert.equal(result.model, "music-2.6");
    assert.equal(result.buffer.toString(), "hi");
    assert.deepEqual(calls.map((call) => call.body.model), ["music-3.0", "music-2.6"]);
  } finally {
    restore(axios, "post", originalPost);
  }
});
