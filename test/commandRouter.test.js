const test = require("node:test");
const assert = require("node:assert");

test("commandRouter: exact name beats alias (build/agent/learn resolution)", () => {
  const { commands } = require("../src/utils/commandRouter");
  // The critical P0 collisions must resolve to the intended command:
  //  - !build should hit the app-builder "build" command, not academy "project"'s alias
  //  - !agent should hit the "agent" command, not "build"'s alias
  //  - !learn should hit the "learn" command, not academy's alias
  // Our dispatch finds the exact NAME first, so verify the intended commands
  // actually OWN those names.
  const byName = Object.fromEntries(commands.map((c) => [c.name, c]));
  assert.strictEqual(byName["build"]?.name, "build", "a 'build' command exists by name");
  assert.strictEqual(byName["agent"]?.name, "agent", "an 'agent' command exists by name");
  assert.strictEqual(byName["learn"]?.name, "learn", "a 'learn' command exists by name");
  assert.strictEqual(byName["run"]?.name, "run", "a 'run' command exists by name");

  // The resolved dispatch: for a trigger, find exact-name match first.
  const resolve = (trigger) => {
    let r = commands.find((c) => c.name === trigger);
    if (!r) r = commands.find((c) => (c.aliases || []).includes(trigger));
    return r?.name || null;
  };
  assert.strictEqual(resolve("build"), "build", "!build resolves to build command");
  assert.strictEqual(resolve("agent"), "agent", "!agent resolves to agent command");
  assert.strictEqual(resolve("learn"), "learn", "!learn resolves to learn command");
  assert.strictEqual(resolve("debug"), "fix", "!debug resolves to the fix/debug command (errors no longer owns it)");
});

test("commandRouter: no duplicate sticker registration (was registered twice)", () => {
  const { commands } = require("../src/utils/commandRouter");
  const stickers = commands.filter((c) => c.name === "sticker");
  assert.strictEqual(stickers.length, 1, "sticker registered exactly once");
});

test("commandRouter: natural hidetag and tag-all requests resolve to group commands", () => {
  const { commands, resolveNaturalAction } = require("../src/utils/commandRouter");
  const hidetag = resolveNaturalAction("Aria, hidetag everyone");
  assert.equal(hidetag?.intent, "hidetag");
  assert.equal(hidetag?.command?.category, "group");
  assert.ok(commands.some((command) => command.name === "hidetag"));
  assert.equal(resolveNaturalAction("Aria, can you hide tag everyone?")?.intent, "hidetag");

  const tagall = resolveNaturalAction("Aria, tag everyone for dinner");
  assert.equal(tagall?.intent, "tagall");
  assert.equal(tagall?.args, "for dinner");
  assert.equal(tagall?.command?.category, "group");

  const builderSource = require("fs").readFileSync(require("path").join(__dirname, "../src/utils/commandRouter.js"), "utf8");
  assert.match(builderSource, /buildProject\(request, ctx\.senderName, ctx\.chatId, onProgress\)/);
  assert.match(builderSource, /buildProject\(request, ctx\.senderName, ctx\.chatId, onProgress\)/);
  assert.match(builderSource, /build: async \(sock, msg, text, ctx\) => handleBuild\(sock, msg, text, ctx\)/);
});

test("commandRouter: hidetag sends hidden mentions when ARIA is a group admin", async () => {
  const { commands } = require("../src/utils/commandRouter");
  const sent = [];
  const sock = {
    user: { id: "bot@s.whatsapp.net" },
    groupMetadata: async () => ({ participants: [
      { id: "bot@s.whatsapp.net", admin: "admin" },
      { id: "237650000001@s.whatsapp.net" },
      { id: "237650000002@s.whatsapp.net" },
    ] }),
    sendMessage: async (chatId, payload) => { sent.push({ chatId, payload }); return {}; },
  };
  const command = commands.find((item) => item.name === "hidetag");
  await command.handler(sock, { key: { remoteJid: "group@g.us" } }, "Dinner is ready", {
    isGroup: true,
    chatId: "group@g.us",
    senderJid: "owner@s.whatsapp.net",
  });
  const hidden = sent.find((item) => item.payload.mentions);
  assert.deepEqual(hidden.payload.mentions, ["bot@s.whatsapp.net", "237650000001@s.whatsapp.net", "237650000002@s.whatsapp.net"]);
  assert.equal(hidden.payload.text, "Dinner is ready");
});

test("commandRouter: zero command collisions (audit #1)", () => {
  // Every name and every alias must be unique across the whole registry. A
  // duplicate (same name twice, or an alias that collides with another name or
  // alias) silently shadows a command. After the #1 fixes the detector must
  // return an empty list.
  const { commands, detectCommandCollisions } = require("../src/utils/commandRouter");
  const collisions = detectCommandCollisions();
  assert.ok(Array.isArray(collisions), "detector returns an array");
  assert.strictEqual(collisions.length, 0, `expected 0 command collisions, got ${collisions.length}: ${collisions.join("; ")}`);
  // Sanity: registry is non-empty.
  assert.ok(commands.length > 10, "registry has a healthy number of commands");
});

test("project reporting formatters produce useful WhatsApp text", () => {
  const { formatProjectStatus, formatProjectList, formatProjectMutation, formatBuildResult } = require("../src/utils/commandRouter")._test;
  const status = formatProjectStatus({
    project: { id: "a1b2c3d4", goal: "FarmShield", status: "done", files: [{ path: "index.html", status: "done" }], deployment: { target: "preview", url: "https://example.vercel.app" } },
    progress: { done: 1, total: 1, percent: 100 },
  });
  assert.match(status, /a1b2c3d4/);
  assert.match(status, /FarmShield/);
  assert.match(status, /https:\/\/example\.vercel\.app/);
  assert.match(formatProjectList([{ id: "a1b2c3d4", status: "done", goal: "FarmShield", progress: { done: 1, total: 1 } }]), /1\/1 files/);
  assert.equal(formatProjectMutation(true, "ok"), "ok");
  assert.match(formatBuildResult({ success: true, projectId: "a1b2c3d4", fileCount: 3, browserSmoke: { success: true }, buildVerification: "passed", downloadUrl: "https://files.example/project.zip" }), /a1b2c3d4/);
});

test("commandRouter: direct GitHub delivery follow-up resolves to deploy", () => {
  const { detectIntent, resolveNaturalAction } = require("../src/utils/commandRouter");
  assert.equal(detectIntent("push the verified project to GitHub"), "deploy");
  assert.equal(resolveNaturalAction("ARIA, push the verified project to GitHub")?.command?.name, "deploy");
});

test("commandRouter: private GitHub PAT intake encrypts, deletes, and never echoes the token", async () => {
  const router = require("../src/utils/commandRouter");
  const vault = require("../src/tools/githubCredentialVault");
  const user = "credential-test@s.whatsapp.net";
  const token = "github_pat_abcdefghijklmnopqrstuvwxyz123456";
  const sent = [];
  const msg = { key: { remoteJid: user, id: "credential-msg-1" } };
  const sock = { sendMessage: async (chatId, payload) => { sent.push({ chatId, payload }); } };
  try {
    await router._test.handlePrivateGithubCredential(sock, msg, `Here is my GitHub access token: ${token}`, { senderJid: user, chatId: user, isGroup: false });
    assert.equal(vault.getTokenForUser(user), token);
    assert.ok(sent.some((item) => item.payload.delete?.id === "credential-msg-1"));
    const responseText = sent.filter((item) => item.payload.text).map((item) => item.payload.text).join("\n");
    assert.doesNotMatch(responseText, new RegExp(token));
    sent.length = 0;
    await router._test.handlePrivateGithubCredential(sock, msg, "What is my GitHub connection status?", { senderJid: user, chatId: user, isGroup: false });
    assert.match(sent.at(-1).payload.text, /connected/);
    assert.doesNotMatch(sent.at(-1).payload.text, new RegExp(token));
  } finally {
    vault.clearTokenForUser(user);
  }
});

test("commandRouter: GitHub PATs sent in groups are rejected and not stored", async () => {
  const router = require("../src/utils/commandRouter");
  const vault = require("../src/tools/githubCredentialVault");
  const user = "group-credential-test@s.whatsapp.net";
  const token = "github_pat_abcdefghijklmnopqrstuvwxyz654321";
  const sent = [];
  const msg = { key: { remoteJid: "group@g.us", id: "credential-msg-2" } };
  const sock = { sendMessage: async (chatId, payload) => { sent.push({ chatId, payload }); } };
  try {
    await router._test.handlePrivateGithubCredential(sock, msg, token, { senderJid: user, chatId: "group@g.us", isGroup: true });
    assert.equal(vault.getTokenForUser(user), "");
    assert.ok(sent.some((item) => item.payload.delete?.id === "credential-msg-2"));
    assert.match(sent.at(-1).payload.text, /private chat/i);
  } finally {
    vault.clearTokenForUser(user);
  }
});
