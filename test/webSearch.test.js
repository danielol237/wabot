const test = require("node:test");
const assert = require("node:assert/strict");
const { searchWithProviders } = require("../src/tools/webSearch")._test;
const { runOperation } = require("../src/utils/operationGuard");

test("web search falls through from a failed Tavily route to Brave", async () => {
  const calls = [];
  const result = await searchWithProviders("reliability", {
    tavily: async () => {
      calls.push("tavily");
      return { success: false, error: "Tavily temporarily unavailable" };
    },
    brave: async () => {
      calls.push("brave");
      return { success: true, output: "Brave result" };
    },
    fallback: async () => "fallback result",
  });
  assert.equal(result, "Brave result");
  assert.deepEqual(calls, ["tavily", "tavily", "brave"]);
});

test("web search reaches scraping fallback when both providers fail", async () => {
  const result = await searchWithProviders("reliability", {
    tavily: async () => ({ success: false, error: "Tavily failed" }),
    brave: async () => ({ success: false, error: "Brave failed" }),
    fallback: async (query) => `fallback:${query}`,
  });
  assert.equal(result, "fallback:reliability");
});

test("operation guard returns semantic failures without logging them as success", async () => {
  const result = await runOperation("test:semantic-failure", async () => ({ success: false, error: "empty response" }), { attempts: 1 });
  assert.deepEqual(result, { success: false, error: "empty response" });
});
