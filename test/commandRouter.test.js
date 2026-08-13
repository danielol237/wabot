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
