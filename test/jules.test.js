const test = require("node:test");
const assert = require("node:assert/strict");

const jules = require("../src/providers/jules");
const { isCodingTask, isExplanationQuestion } = require("../src/utils/taskClassifier");

function preserveEnv(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}
function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test("taskClassifier detects software engineering coding tasks for Jules", () => {
  const codingTaskQueries = [
    "Fix this bug in my Node app",
    "Debug this error in server.js",
    "Why is this function failing?",
    "Write a function that calculates fibonacci",
    "Create an API endpoint for user registration",
    "Build this feature in React",
    "Modify this code to handle 404s",
    "Refactor this file",
    "Fix the authentication system",
    "Add GitHub integration to my bot",
    "Implement this feature",
    "Find what's wrong with this code",
    "Review this implementation",
    "Update the database schema",
    "Create a backend in Express",
    "Fix the Docker configuration",
    "Make this React component work",
    "Add a new command to ARIA",
  ];

  for (const query of codingTaskQueries) {
    assert.equal(isCodingTask(query), true, `Expected "${query}" to be classified as a coding task`);
  }
});

test("taskClassifier routes normal conversation and technical explanations away from Jules", () => {
  const nonCodingQueries = [
    "What's the weather like?",
    "Explain what Docker is",
    "What does async/await mean?",
    "Who is Batman?",
    "Tell me a joke",
    "How are you doing today?",
    "What is a REST API?",
    "Explain quantum computing",
  ];

  for (const query of nonCodingQueries) {
    assert.equal(isCodingTask(query), false, `Expected "${query}" NOT to be classified as a coding task`);
  }
});

test("jules provider availability depends on JULES_API_KEY", () => {
  const env = preserveEnv(["JULES_API_KEY"]);
  delete process.env.JULES_API_KEY;
  try {
    assert.equal(jules.isAvailable(), false);

    process.env.JULES_API_KEY = "jules_secret_key_12345";
    assert.equal(jules.isAvailable(), true);
  } finally {
    restoreEnv(env);
  }
});

test("jules provider handles missing key cleanly without crashing", async () => {
  const env = preserveEnv(["JULES_API_KEY"]);
  delete process.env.JULES_API_KEY;
  try {
    await assert.rejects(
      jules.executeCodingTask("Fix this function"),
      (err) => err.message.includes("JULES_API_KEY is not configured") || err.message.includes("unavailable")
    );
  } finally {
    restoreEnv(env);
  }
});
