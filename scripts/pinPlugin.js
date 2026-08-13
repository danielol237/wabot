// ── Pin a plugin hash for the marketplace ────────────────────
// The plugin marketplace is fail-closed by design: !install refuses any plugin
// that doesn't have a pinned SHA-256 in data/pluginHashes.json. This script is
// the maintainer tooling to pin a hash so the marketplace can actually install
// the plugin.
//
// Usage:
//   node scripts/pinPlugin.js <plugin-id> [<expected-sha256>]
//
// If <expected-sha256> is provided, it MUST match the downloaded file's hash or
// the pin is aborted (prevents pinning a tampered/compromised file). If omitted,
// the hash is computed and written (you should eyeball the output carefully).
//
// This does NOT weaken the fail-closed gate: it only writes the manifest that
// installPlugin() already requires. An unpinned plugin still refuses to install.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");

const HASHES_FILE = path.join(__dirname, "../data/pluginHashes.json");
const PLUGIN_REPO = "https://raw.githubusercontent.com/danielol237/wabot-plugins/main";

const id = process.argv[2];
const expected = process.argv[3] || null;

if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
  console.error("Usage: node scripts/pinPlugin.js <plugin-id> [<expected-sha256>]");
  process.exit(1);
}

(async () => {
  const url = `${PLUGIN_REPO}/plugins/${id}.js`;
  console.log(`Fetching ${url} ...`);
  const res = await axios.get(url, { timeout: 15000 });
  const data = typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  const hash = crypto.createHash("sha256").update(data).digest("hex");

  if (expected && hash !== expected) {
    console.error(`✗ Hash MISMATCH. Expected ${expected}\n               Got      ${hash}\nAborting — do not pin a file that doesn't match your expected hash.`);
    process.exit(1);
  }

  let manifest = { plugins: {} };
  try { if (fs.existsSync(HASHES_FILE)) manifest = JSON.parse(fs.readFileSync(HASHES_FILE, "utf8")); } catch (_) {}
  if (!manifest.plugins) manifest.plugins = {};
  manifest.plugins[id] = hash;
  fs.mkdirSync(path.dirname(HASHES_FILE), { recursive: true });
  fs.writeFileSync(HASHES_FILE, JSON.stringify(manifest, null, 2) + "\n");

  console.log(`✓ Pinned ${id}:`);
  console.log(`  ${hash}`);
  console.log(`Written to ${HASHES_FILE}`);
  console.log("Now `!install " + id + "` will succeed (after restart / reload).");
})().catch((e) => {
  console.error("✗ Failed:", e.message);
  process.exit(1);
});
