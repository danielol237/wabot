const mode = process.argv[2] || "pollinations";
const axios = require("axios");

if (mode === "minimax") {
  process.env.MINIMAX_API_KEY = "test-key";
  process.env.MINIMAX_BASE_URL = "https://api.example/v1";
  delete process.env.ZHIPU_API_KEY;
  const originalPost = axios.post;
  const originalGet = axios.get;
  axios.post = async (url, body) => ({ data: { data: { image_urls: ["https://cdn.example/image.png"] }, base_resp: { status_code: 0 }, request: { url, body } } });
  axios.get = async () => ({ headers: { "content-type": "image/png" }, data: Buffer.from("png-bytes") });
  (async () => {
    try {
      const result = await require("../../src/tools/imageGen").generateImage("a cinematic dog");
      process.stdout.write(JSON.stringify({ success: result.success, provider: result.provider, hasBuffer: Boolean(result.buffer), mimetype: result.mimetype, bytes: result.buffer?.toString() }));
    } finally {
      axios.post = originalPost;
      axios.get = originalGet;
    }
  })().catch((error) => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });
} else {
  delete process.env.MINIMAX_API_KEY;
  delete process.env.ZHIPU_API_KEY;
  const originalGet = axios.get;
  axios.get = async () => ({ headers: { "content-type": "image/jpeg" }, data: Buffer.from("fallback-image") });
  (async () => {
    try {
      const result = await require("../../src/tools/imageGen").generateImage("a warm sunrise");
      process.stdout.write(JSON.stringify({ success: result.success, provider: result.provider, hasBuffer: Boolean(result.buffer), mimetype: result.mimetype, bytes: result.buffer?.toString() }));
    } finally {
      axios.get = originalGet;
    }
  })().catch((error) => { process.stderr.write(error.stack || String(error)); process.exitCode = 1; });
}
