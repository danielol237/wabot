const assert = require("assert");
const path = require("path");
const { test } = require("node:test");

const RepositoryDiscovery = require("../src/coding/discovery/RepositoryDiscovery");
const CodebaseIndexer = require("../src/coding/discovery/CodebaseIndexer");
const ContextBuilder = require("../src/coding/discovery/ContextBuilder");

test("RepositoryDiscovery inspects Node.js project metadata accurately", () => {
  const discovery = new RepositoryDiscovery(process.cwd());
  const info = discovery.inspect();

  assert.strictEqual(info.projectType, "nodejs");
  assert.strictEqual(info.testFramework, "node-native");
  assert.ok(info.scripts.test);
  assert.ok(info.hasGit);
});

test("CodebaseIndexer catalogues repository files and searches by query", () => {
  const indexer = new CodebaseIndexer(process.cwd());
  const index = indexer.index();

  assert.ok(index.totalFiles > 0);
  const search = indexer.searchFiles("taskClassifier");
  assert.ok(search.some((f) => f.path.includes("taskClassifier.js")));
});

test("ContextBuilder builds focused context for user request", () => {
  const builder = new ContextBuilder(process.cwd());
  const ctx = builder.buildContext("Fix Docker detection in taskClassifier.js");

  assert.ok(ctx.discovery);
  assert.ok(ctx.relevantFiles.length > 0);
  assert.ok(ctx.relevantFiles.some((f) => f.path.includes("package.json")));
});
