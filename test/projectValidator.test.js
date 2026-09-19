const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { STATES, validateProject } = require("../src/tools/projectValidator");

function fixture(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aria-project-validator-"));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
  return root;
}

test("project validator accepts declared dependencies and resolvable local imports", () => {
  const root = fixture({
    "package.json": JSON.stringify({ dependencies: { express: "^4.0.0" }, scripts: { build: "node build.js" } }),
    "src/index.js": "const express = require('express'); const helper = require('./helper'); module.exports = { express, helper };",
    "src/helper.js": "module.exports = true;",
  });
  const result = validateProject(root);
  assert.equal(result.state, STATES.VALID);
  assert.equal(result.errors.length, 0);
  assert.equal(result.checks.dependencies, STATES.VALID);
  assert.equal(result.checks.imports, STATES.VALID);
});

test("project validator rejects undeclared packages and missing local modules", () => {
  const root = fixture({
    "package.json": JSON.stringify({ dependencies: {}, scripts: { build: "node build.js" } }),
    "index.js": "require('not-installed'); require('./missing');",
  });
  const result = validateProject(root);
  assert.equal(result.state, STATES.INVALID);
  assert.ok(result.errors.some((item) => /not declared/.test(item.message)));
  assert.ok(result.errors.some((item) => /does not exist/.test(item.message)));
});

test("validator does not claim unknown static projects are fully dependency-verified", () => {
  const root = fixture({ "index.html": "<!doctype html><html><body><h1>ARIA</h1></body></html>" });
  const result = validateProject(root);
  assert.equal(result.state, STATES.VALID);
  assert.equal(result.checks.dependencies, STATES.NOT_VERIFIED);
  assert.equal(result.checks.scripts, STATES.NOT_VERIFIED);
});
