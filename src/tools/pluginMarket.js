// ── Plugin Marketplace ──────────────────────────────────────
// !plugins — list available plugins from GitHub
// !install <name> — download and install a plugin
// !disable <name> / !enable <name> — toggle plugins
// !update <name> — update a plugin from source

const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { execFileSync } = require("child_process");
const crypto = require("crypto");

const PLUGINS_DIR = path.join(__dirname, "../../plugins");
const STATE_FILE = path.join(__dirname, "../../data/pluginState.json");
const HASHES_FILE = path.join(__dirname, "../../data/pluginHashes.json");

// Official plugin repository (GitHub raw URLs)
const PLUGIN_REPO = {
  base: "https://raw.githubusercontent.com/danielol237/wabot-plugins/main",
  manifest: "https://raw.githubusercontent.com/danielol237/wabot-plugins/main/plugins.json",
};

// Local plugin state (enabled/disabled)
let state = { installed: {}, disabled: [] };

function loadState() {
  try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch (e) {}
}
function saveState() {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2)); } catch (e) {}
}
loadState();

// ── Pinned-hash supply-chain verification ─────────────────────
// The plugin repo (wabot-plugins) is the same trust domain as the code it
// serves — a manifest hash from there proves nothing if the repo is hit. So
// we pin known-good SHA-256 hashes HERE, in this repo, and fail closed if a
// downloaded file doesn't match (or has no pinned hash at all).
let pinnedHashes = { plugins: {} };
try {
  if (fs.existsSync(HASHES_FILE)) pinnedHashes = JSON.parse(fs.readFileSync(HASHES_FILE, "utf8"));
} catch (e) {}

function sha256(data) {
  return crypto.createHash("sha256").update(data).digest("hex");
}

// Returns { ok, error } for a plugin id + raw file contents. Throws nothing.
function verifyPluginContent(pluginId, data) {
  const expected = pinnedHashes.plugins && pinnedHashes.plugins[pluginId];
  if (!expected) {
    return { ok: false, error: `No pinned SHA-256 for plugin "${pluginId}". It will not be installed until a maintainer pins its hash in data/pluginHashes.json.` };
  }
  const actual = sha256(data);
  if (actual !== expected) {
    return { ok: false, error: `Plugin "${pluginId}" hash mismatch (got ${actual.slice(0, 12)}…, expected ${expected.slice(0, 12)}…). Refusing to install — the source may have changed or been tampered with.` };
  }
  return { ok: true };
}

// Fetch the plugin manifest from GitHub
async function fetchManifest() {
  try {
    const res = await axios.get(PLUGIN_REPO.manifest, { timeout: 10000 });
    return res.data.plugins || [];
  } catch (e) {
    // Fallback: built-in plugin list
    return [
      { id: "anime", name: "Anime", desc: "Search, download, track anime", size: "12KB" },
      { id: "music", name: "Music", desc: "Download songs from any platform", size: "8KB" },
      { id: "weather", name: "Weather", desc: "Current weather & forecasts", size: "5KB" },
      { id: "news", name: "News", desc: "Latest news from any source", size: "6KB" },
      { id: "finance", name: "Finance", desc: "Stock prices, crypto, forex", size: "9KB" },
      { id: "minecraft", name: "Minecraft", desc: "Server status, player lookup", size: "7KB" },
      { id: "productivity", name: "Productivity", desc: "Todo, notes, reminders", size: "10KB" },
      { id: "github", name: "GitHub", desc: "Repo stats, PRs, issues", size: "11KB" },
      { id: "social", name: "Social", desc: "Instagram, Twitter, Reddit tools", size: "14KB" },
      { id: "code", name: "Code", desc: "Run & share code snippets", size: "8KB" },
    ];
  }
}

// Marketplace IDs flow into filesystem paths and shell commands. Restrict to a
// safe charset so a hostile/invalid id can't traverse or inject.
const SAFE_ID = /^[a-zA-Z0-9_-]+$/;
function validPluginId(pluginId) {
  return typeof pluginId === "string" && SAFE_ID.test(pluginId);
}

// Download + hash-verify + write a plugin file to disk. Shared by install and
// update so both go through the same supply-chain gate.
async function downloadVerifiedPlugin(pluginId) {
  if (!validPluginId(pluginId)) return { success: false, error: "Invalid plugin id. Use letters, numbers, -, _." };
  const url = `${PLUGIN_REPO.base}/plugins/${pluginId}.js`;
  const res = await axios.get(url, { timeout: 15000 });
  const v = verifyPluginContent(pluginId, res.data);
  if (!v.ok) return { success: false, error: v.error };

  const filePath = path.join(PLUGINS_DIR, pluginId + ".js");
  fs.writeFileSync(filePath, res.data);
  try {
    execFileSync(process.execPath, ["--check", filePath], { stdio: "pipe" });
  } catch (e) {
    fs.unlinkSync(filePath);
    return { success: false, error: "Plugin has syntax errors. Not installed." };
  }
  return { success: true, filePath };
}

// Install a plugin from the marketplace
async function installPlugin(pluginId) {
  try {
    if (!validPluginId(pluginId)) return { success: false, error: "Invalid plugin id. Use letters, numbers, -, _." };
    // Check if already installed
    if (state.installed[pluginId]) return { success: false, error: "Already installed." };
    if (fs.existsSync(path.join(PLUGINS_DIR, pluginId + ".js"))) {
      state.installed[pluginId] = { installedAt: Date.now() };
      saveState();
      return { success: true, installed: true };
    }

    const dl = await downloadVerifiedPlugin(pluginId);
    if (!dl.success) return dl;
    state.installed[pluginId] = { installedAt: Date.now(), version: 1 };
    saveState();
    return { success: true, installed: true };
  } catch (e) {
    return { success: false, error: `Install failed: ${e.message}` };
  }
}

// Update a plugin to its latest pinned version (re-download + verify hash).
async function updatePlugin(pluginId) {
  try {
    if (!validPluginId(pluginId)) return { success: false, error: "Invalid plugin id. Use letters, numbers, -, _." };
    if (!fs.existsSync(path.join(PLUGINS_DIR, pluginId + ".js")) && !state.installed[pluginId]) {
      return { success: false, error: `Plugin "${pluginId}" is not installed. Use !install ${pluginId} first.` };
    }
    const dl = await downloadVerifiedPlugin(pluginId);
    if (!dl.success) return dl;
    state.installed[pluginId] = {
      installedAt: state.installed[pluginId]?.installedAt || Date.now(),
      version: (state.installed[pluginId]?.version || 1) + 1,
      updatedAt: Date.now(),
    };
    saveState();
    return { success: true, installed: true, updated: true };
  } catch (e) {
    return { success: false, error: `Update failed: ${e.message}` };
  }
}

// Disable/enable plugins
function setPluginState(pluginId, enabled) {
  if (enabled) {
    state.disabled = state.disabled.filter(id => id !== pluginId);
  } else {
    if (!state.disabled.includes(pluginId)) state.disabled.push(pluginId);
  }
  saveState();
  return { success: true };
}

function isPluginEnabled(pluginId) {
  return !state.disabled.includes(pluginId);
}

// List installed plugins
function listInstalled() {
  const files = fs.readdirSync(PLUGINS_DIR).filter(f => f.endsWith(".js"));
  const plugins = files.map(f => ({
    id: f.replace(".js", ""),
    enabled: isPluginEnabled(f.replace(".js", "")),
    locally: true,
  }));

  // Add marketplace-installed ones
  for (const [id, info] of Object.entries(state.installed)) {
    if (!plugins.find(p => p.id === id)) {
      plugins.push({ id, enabled: isPluginEnabled(id), locally: false, info });
    }
  }
  return plugins;
}

module.exports = { fetchManifest, installPlugin, updatePlugin, setPluginState, isPluginEnabled, listInstalled, verifyPluginContent, validPluginId, sha256, PLUGIN_REPO };
