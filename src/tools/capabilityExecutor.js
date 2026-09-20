const { operationResult } = require("../utils/capabilityCatalog");
const actionTask = require("./actionTask");
const nativeMedia = require("./nativeMedia");
const { inspectEnvironment } = require("../utils/capabilityCatalog");

const REGISTRY = new Map();
function registerCapability(definition) {
  if (!definition?.name || typeof definition.run !== "function") throw new Error("A capability needs a name and run function.");
  REGISTRY.set(String(definition.name), { ...definition });
  return definition.name;
}
function listRegisteredCapabilities() {
  return [...REGISTRY.values()].map(({ run, ...definition }) => ({ ...definition }));
}
function getRegisteredCapability(name) { return REGISTRY.get(String(name || "")) || null; }
function discoverCapabilities(query = "") {
  const terms = String(query || "").toLowerCase().split(/\s+/).filter(Boolean);
  return listRegisteredCapabilities().filter((item) => !terms.length || terms.some((term) => `${item.name} ${item.description || ""} ${(item.tags || []).join(" ")}`.toLowerCase().includes(term)));
}
function registerBuiltIns() {
  registerCapability({ name: "media.inspect_image", description: "Inspect image dimensions, format, animation, alpha, size, and checksum locally.", tags: ["image", "sticker", "vision", "native"], input: ["buffer"], output: ["metadata"], permissions: "conversation participant", run: ({ buffer, options }) => nativeMedia.inspectImage(buffer, options) });
  registerCapability({ name: "media.convert_image", description: "Convert or resize an image locally with Sharp.", tags: ["image", "resize", "crop", "compress", "native"], input: ["buffer", "format"], output: ["buffer", "checksum"], permissions: "conversation participant", run: ({ buffer, options }) => nativeMedia.convertImage(buffer, options) });
  registerCapability({ name: "media.transcode", description: "Transcode audio or video locally with FFmpeg when installed.", tags: ["audio", "video", "ffmpeg", "native"], input: ["buffer", "codec"], output: ["buffer", "checksum"], permissions: "conversation participant", run: ({ buffer, options }) => nativeMedia.transcodeMedia(buffer, options) });
  registerCapability({ name: "speech.synthesize_local", description: "Generate speech locally with espeak or espeak-ng when installed.", tags: ["speech", "audio", "tts", "native"], input: ["text"], output: ["audio buffer"], permissions: "conversation participant", run: ({ text, options }) => nativeMedia.textToSpeechLocal(text, options) });
  registerCapability({ name: "connectors.discover", description: "Inspect actual local tools, connectors, and storage availability.", tags: ["connectors", "health", "runtime"], input: ["query"], output: ["environment report"], permissions: "conversation participant", run: async () => ({ success: true, environment: inspectEnvironment() }) });
  registerCapability({ name: "whatsapp.send_media", description: "Send verified media through an injected active WhatsApp socket.", tags: ["whatsapp", "send", "media"], input: ["sock", "chatId", "payload"], output: ["message key"], permissions: "explicit recipient-scoped request", run: async ({ sock, chatId, payload }) => {
    if (!sock || typeof sock.sendMessage !== "function") return { success: false, error: "WhatsApp socket is not available." };
    if (!chatId || !payload || typeof payload !== "object") return { success: false, error: "A recipient and media payload are required." };
    const sent = await sock.sendMessage(chatId, payload);
    return { success: true, messageId: sent?.key?.id || null, remoteJid: sent?.key?.remoteJid || chatId };
  } });
}
registerBuiltIns();
async function executePlan({ goal = "", steps = [], chatId = null, context = {}, onProgress = null } = {}) {
  const task = actionTask.createTask({ type: "capability.plan", goal, chatId, steps: steps.map((step) => ({ id: step.id, label: step.label || step.capability, dependsOn: step.dependsOn || [] })) });
  const outputs = {};
  for (const step of steps) {
    const capability = getRegisteredCapability(step.capability);
    if (!capability) {
      await actionTask.runStep(task, step.id, async () => { throw new Error(`Capability not registered: ${step.capability}`); });
      continue;
    }
    const result = await actionTask.runStep(task, step.id, async () => {
      if (onProgress) await onProgress({ taskId: task.id, stepId: step.id, capability: capability.name, state: "RUNNING" });
      const input = typeof step.input === "function" ? await step.input(outputs, context) : { ...(step.input || {}), ...context };
      const output = await capability.run(input);
      if (!output?.success) throw new Error(output?.error || `${capability.name} failed.`);
      outputs[step.id] = output;
      return { capability: capability.name, success: true, bytes: output.bytes || null, sha256: output.sha256 || null };
    }, { verify: (output) => output?.success === true });
    if (onProgress) await onProgress({ taskId: task.id, stepId: step.id, capability: capability.name, state: result.state });
    if (result.state !== actionTask.STATES.COMPLETED) break;
  }
  actionTask.finish(task);
  return operationResult({ capability: "capability.plan", state: task.state === actionTask.STATES.COMPLETED ? "SUCCEEDED" : task.state === actionTask.STATES.FAILED ? "FAILED" : "PARTIALLY_SUCCEEDED", output: outputs, error: task.state === actionTask.STATES.COMPLETED ? null : task.steps.find((step) => step.error)?.error || null, evidence: task.steps.map((step) => ({ stepId: step.id, state: step.state, result: step.result })) });
}
module.exports = { registerCapability, listRegisteredCapabilities, getRegisteredCapability, discoverCapabilities, executePlan, _test: { REGISTRY } };
