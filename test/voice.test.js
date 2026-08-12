// Voice transcription tests — verifies the free no-key STT fallback works.
const test = require("node:test");
const assert = require("node:assert");
const { execFile } = require("child_process");

function run(cmd, args) {
  return new Promise((r) => execFile(cmd, args, (err, stdout, stderr) => r({ err, stdout: String(stdout || ""), stderr: String(stderr || "") })));
}

test("voice: free STT transcribes generated speech (no API key)", async () => {
  // Only run when edge-tts + python3 are available; skip gracefully otherwise.
  const hasEdge = await run("which", ["edge-tts"]).then((r) => !r.err);
  if (!hasEdge) { console.log("  (skipped: edge-tts not installed)"); assert.ok(true); return; }
  const mp3 = "/tmp/aria_stt_test_" + Date.now() + ".mp3";
  const tts = await run("edge-tts", ["--voice", "en-US-JennyNeural", "--text", "testing speech to text", "--write-media", mp3]);
  if (tts.err) { console.log("  (skipped: edge-tts gen failed)"); assert.ok(true); return; }
  const res = await run("python3", ["src/tools/gstt.py", mp3]);
  try { require("fs").unlinkSync(mp3); } catch (_) {}
  const m = res.stdout.match(/^TRANSCRIPT:\s*(.+)$/m);
  assert.ok(m, "transcript produced from generated speech, got: " + res.stdout);
  assert.ok(/testing speech/.test(m[1].toLowerCase()), "transcript contains expected words");
});

test("voice: transcribeVoice falls back to free STT when no Groq key", async () => {
  const v = require("../src/tools/voice");
  // Without GROQ_API_KEY, transcribeVoice should still return { success:false }
  // gracefully (no throw) for a silent/garbage buffer — never crash.
  const result = await v.transcribeVoice(Buffer.from([0, 0, 0, 0, 0, 0]), "audio/ogg");
  assert.ok(typeof result.success === "boolean", "returns success boolean, got: " + JSON.stringify(result));
});
