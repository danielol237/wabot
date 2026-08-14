const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { resolveYtDlp, commandArgs } = require("../src/utils/mediaRuntime");

test("mediaRuntime: explicit project-local yt-dlp path is resolved with its arguments", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aria-media-runtime-"));
  const fake = path.join(dir, "yt-dlp");
  fs.writeFileSync(fake, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const previous = process.env.ARIA_YTDLP_PATH;
  process.env.ARIA_YTDLP_PATH = fake;
  try {
    const command = resolveYtDlp();
    assert.ok(command);
    assert.equal(command.file, fake);
    assert.deepEqual(commandArgs(command, ["--version"]), ["--version"]);
  } finally {
    if (previous === undefined) delete process.env.ARIA_YTDLP_PATH;
    else process.env.ARIA_YTDLP_PATH = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
