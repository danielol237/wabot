const Module = require("module");
const mode = process.argv[2] || "missing";
const originalLoad = Module._load;

Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "axios") {
    return {
      post: async (url, body) => {
        if (mode === "failure") {
          const error = new Error("request rejected");
          error.response = { status: 401, data: { message: "invalid key" } };
          throw error;
        }
        if (url.endsWith("/images/generations")) {
          if (mode === "image-direct") return { data: { images: [{ url: "https://cdn.example/image.png" }] } };
          return { data: { id: "image-task-1" } };
        }
        if (url.endsWith("/videos/generations")) return { data: { task_id: "video-task-1" } };
        if (url.endsWith("/chat/completions")) return { data: { choices: [{ message: { content: "A calm orchid orbital ribbon mark." } }] } };
        throw new Error(`unexpected POST ${url}`);
      },
      get: async (url) => {
        if (url.endsWith("/async-result/image-task-1")) return { data: { status: "SUCCESS", data: { result: { url: "https://cdn.example/image-async.png" } } } };
        if (url.endsWith("/async-result/video-task-1")) return { data: { status: "SUCCESS", video_result: { url: "https://cdn.example/video.mp4" } } };
        throw new Error(`unexpected GET ${url}`);
      },
    };
  }
  return originalLoad(request, parent, isMain);
};

if (!['missing', 'config'].includes(mode)) process.env.ZHIPU_API_KEY = "test-zai-key";
const zai = require("../../src/tools/zaiMedia");

(async () => {
  let result;
  if (mode === "config") result = { configured: zai.configured() };
  else if (mode === "image-direct") result = await zai.generateImage("an orbital ribbon mark");
  else if (mode === "image-async") result = await zai.generateImage("an editorial cover", { pollMs: 1000 });
  else if (mode === "video") result = await zai.generateVideo("a ribbon moving through a warm studio", { pollMs: 1000 });
  else if (mode === "vision") result = await zai.analyzeImage("aW1hZ2U=", "image/png", "Describe the mark.");
  else if (mode === "failure") result = await zai.generateImage("should fail");
  else result = await zai.generateImage("should report missing config");
  process.stdout.write(JSON.stringify(result));
})().catch((error) => {
  process.stdout.write(JSON.stringify({ fatal: error.message }));
  process.exitCode = 1;
});
