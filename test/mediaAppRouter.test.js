const test = require("node:test");
const assert = require("node:assert/strict");
const mediaAppRouter = require("../src/mediaAppRouter");

test("mediaAppRouter is defined and callable as middleware", () => {
  assert.equal(typeof mediaAppRouter, "function");
});
