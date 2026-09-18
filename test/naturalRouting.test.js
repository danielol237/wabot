const test = require("node:test");
const assert = require("node:assert/strict");

const router = require("../src/utils/commandRouter");

test("natural routing resolves owner build requests without a prefix", () => {
  const action = router.resolveNaturalAction("ARIA, build me a landing page for ARIA");
  assert.equal(action.intent, "build");
  assert.equal(action.args, "landing page for ARIA");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing resolves delegation and keeps the owner-only boundary", () => {
  const action = router.resolveNaturalAction("delegate this research to the agent team");
  assert.equal(action.intent, "delegate");
  assert.equal(action.args, "research to the agent team");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing resolves owner file edits without a prefix", () => {
  const action = router.resolveNaturalAction("ARIA edit src/index.js to add a health route");
  assert.equal(action.intent, "edit");
  assert.equal(action.args, "src/index.js to add a health route");
  assert.equal(action.command.ownerOnly, true);
});

test("natural routing sends dashboard and repository changes to engineering", () => {
  const dashboard = router.resolveNaturalAction("ARIA, change your dashboard UI in the wabot repo");
  assert.equal(dashboard.intent, "engineering");
  assert.equal(dashboard.command.ownerOnly, false);

  const companion = router.resolveNaturalAction("ARIA improve the Android companion app in danielol237/aria-android-companion");
  assert.equal(companion.intent, "engineering");
  assert.equal(companion.command.ownerOnly, false);
});

test("natural routing supports explicit repositories and per-user workspace commands", () => {
  const action = router.resolveNaturalAction("ARIA, work on danielol237/aria-android-companion");
  assert.equal(action.intent, "engineering");
  assert.equal(action.command.ownerOnly, false);
  assert.equal(router.resolveNaturalAction("ARIA, list my GitHub repos").intent, "engineering");
  assert.equal(router.resolveNaturalAction("ARIA, use my GitHub repo owner/project").intent, "engineering");
  assert.equal(router.resolveNaturalAction("ARIA, let's work now on the Android Companion repo").intent, "engineering");
});

test("natural routing understands human repository-check language", () => {
  for (const phrase of ["ARIA, check my repos", "ARIA, show my repositories", "ARIA, check my repo", "ARIA, inspect my repo", "ARIA, check danielol237/wabot"]) {
    const action = router.resolveNaturalAction(phrase);
    assert.equal(action?.intent, "engineering", phrase);
    assert.equal(action?.command?.ownerOnly, false, phrase);
  }
});

test("natural routing recognizes broad social-media download requests", () => {
  for (const phrase of [
    "ARIA, download this link https://www.youtube.com/watch?v=abc123",
    "ARIA, please download https://www.tiktok.com/@creator/video/123",
    "ARIA, save this reel https://www.instagram.com/reel/ABC123/",
    "ARIA, can you fetch this video for me https://www.facebook.com/watch/?v=123",
    "ARIA, send me the video https://example.com/video.mp4",
  ]) {
    const action = router.resolveNaturalAction(phrase);
    assert.equal(action?.intent, "download", phrase);
    assert.equal(action?.command?.ownerOnly, false, phrase);
  }
});

test("natural routing resolves capability discovery, memory recall, and website links", () => {
  assert.equal(router.resolveNaturalAction("what can you do").intent, "help");
  assert.equal(router.resolveNaturalAction("what do you remember about me").intent, "memories");
  assert.equal(router.resolveNaturalAction("give me link to dashboard").intent, "links");
  assert.equal(router.resolveNaturalAction("open the anime website").intent, "links");
  assert.equal(router.resolveNaturalAction("anime Naruto").intent, "anime");
  assert.equal(router.resolveNaturalAction("start a project backend beginner").intent, "project");
  assert.equal(router.resolveNaturalAction("start a mission audit the bot").intent, "mission");
  assert.equal(router.resolveNaturalAction("create a poll Best anime? | One Piece | Naruto").intent, "poll");
  assert.equal(router.resolveNaturalAction("ARIA, this is a project: launch the site by December").intent, "atlas");
  assert.equal(router.resolveNaturalAction("what is blocking us?").intent, "atlas");
  assert.equal(router.resolveNaturalAction("add a task: verify Android downloads").intent, "atlas");
  assert.equal(router.resolveNaturalAction("record a decision: keep QR pairing owner-only").intent, "atlas");
  assert.equal(router.resolveNaturalAction("plan this project").intent, "atlas");
  assert.equal(router.resolveNaturalAction("plan this").intent, "atlas");
  assert.equal(router.resolveNaturalAction("make a plan").intent, "atlas");
  assert.equal(router.resolveNaturalAction("break the project down").intent, "atlas");
  assert.equal(router.resolveNaturalAction("show the roadmap").intent, "atlas");
  assert.equal(router.resolveNaturalAction("apply the plan").intent, "atlas");
  assert.equal(router.resolveNaturalAction("show Sentinel").intent, "atlas");
  assert.equal(router.resolveNaturalAction("what changed in the project").intent, "atlas");
  assert.equal(router.resolveNaturalAction("acknowledge signal signal_test").intent, "atlas");
  assert.equal(router.resolveNaturalAction("approve brief brief_test").intent, "atlas");
});

test("natural routing understands generation prompts without a prefix", () => {
  const image = router.resolveNaturalAction("ARIA generate the image of a dog running through a field");
  assert.equal(image.intent, "image");
  assert.equal(image.args, "a dog running through a field");

  const video = router.resolveNaturalAction("ARIA generate my damn video of a dog on the beach");
  assert.equal(video.intent, "video");
  assert.equal(video.args, "a dog on the beach");

  const music = router.resolveNaturalAction("ARIA make me a dark afrobeats song for a night drive");
  assert.equal(music.intent, "music");
  assert.equal(music.args, "dark afrobeats song for a night drive");

  const voice = router.resolveNaturalAction("ARIA generate a voice saying I am on my way");
  assert.equal(voice.intent, "voiceGenerate");
  assert.equal(voice.args, "saying I am on my way");
});

test("natural routing does not mistake ordinary conversation for generation", () => {
  assert.equal(router.resolveNaturalAction("I watched a video of a dog today"), null);
  assert.equal(router.resolveNaturalAction("the song was good"), null);
});

test("legacy prefix commands remain resolvable during migration", () => {
  const action = router.resolveNaturalAction("!help");
  assert.equal(action, null);
  assert.equal(router.detectIntent("what can you do"), "help");
});

test("natural routing resolves an explicit addressed group removal request to the registered permission-checked command", () => {
  const action = router.resolveNaturalAction("ARIA, remove @234812345678");
  assert.equal(action.intent, "kick");
  assert.equal(action.command.name, "kick");
  assert.equal(action.command.category, "group");
});

test("natural routing resolves V4 integration diagnostics without a prefix", () => {
  assert.equal(router.resolveNaturalAction("diagnose integrations").intent, "atlas");
  assert.equal(router.resolveNaturalAction("check the webhook connection").intent, "atlas");
  assert.equal(router.resolveNaturalAction("show delivery diagnostics").intent, "atlas");
});


test("natural routing resolves V5 execution controls without a prefix", () => {
  const phrases = [
    "start a research execution",
    "start a build run",
    "execute the next safe step",
    "show execution status",
    "approve execution",
    "pause execution",
    "what evidence is missing",
    "propose recovery",
    "retrospect this run",
  ];
  for (const phrase of phrases) assert.equal(router.resolveNaturalAction(phrase).intent, "atlas", phrase);
});


test("natural routing resolves V6 operator-team controls without a prefix", () => {
  const phrases = [
    "start an operator team",
    "start a research team",
    "show team status",
    "show team handoff",
    "approve team",
    "pause the operator team",
    "why is the team blocked",
    "review release readiness",
    "retrospect the operator team",
  ];
  for (const phrase of phrases) assert.equal(router.resolveNaturalAction(phrase).intent, "atlas", phrase);
});


test("natural routing resolves V7 project knowledge and artifact controls without a prefix", () => {
  const phrases = [
    "show the project knowledge graph",
    "what supports this requirement",
    "what is blocking this project",
    "show stale project knowledge",
    "show conflicts in the project",
    "trace this artifact",
    "record this as a project requirement",
    "add this artifact to the project vault",
    "what changed in the project knowledge",
  ];
  for (const phrase of phrases) assert.equal(router.resolveNaturalAction(phrase).intent, "atlas", phrase);
});


test("natural routing resolves V8 connected-delivery controls without a prefix", () => {
  const phrases = [
    "show connected delivery",
    "connected delivery status",
    "is the release ready",
    "show deployment evidence",
    "show delivery proposals",
    "map github repository danielol237/wabot",
    "connect render srv-demo",
    "what failed in github",
    "approve delivery_test",
    "reject delivery_test",
    "resolve delivery_test",
  ];
  for (const phrase of phrases) assert.equal(router.resolveNaturalAction(phrase).intent, "atlas", phrase);
});


test("natural routing resolves named website recall and auto-upgrade requests", () => {
  const recall = router.resolveNaturalAction("ARIA remember the restaurant website we built");
  assert.equal(recall.intent, "projectrecall");
  assert.match(recall.args, /restaurant website/i);
  const upgrade = router.resolveNaturalAction("ARIA auto upgrade the restaurant website");
  assert.equal(upgrade.intent, "projectupgrade");
  assert.match(upgrade.args, /restaurant website/i);
  const polish = router.resolveNaturalAction("ARIA improve this website: remove the generic hero copy");
  assert.equal(polish.intent, "projectupgrade");
  assert.match(polish.args, /generic hero copy/i);
});


test("natural routing keeps project improvement follow-ups in the project-upgrade flow", () => {
  assert.equal(router.resolveNaturalAction("ARIA improve the design").intent, "projectupgrade");
  assert.equal(router.resolveNaturalAction("ARIA make some changes").intent, "projectupgrade");
});
