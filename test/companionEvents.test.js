const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");
const WebSocket = require("ws");

process.env.COMPANION_API_KEY = "event-test-secret";
process.env.OWNER_NUMBER = "237650284057";
const events = require("../src/companionEvents");

function openServer() {
  const server = http.createServer();
  events.attach(server);
  return new Promise((resolve) => server.listen(0, () => resolve(server)));
}

test("companion event hub rejects unauthenticated WebSocket upgrades", { concurrency: false }, async () => {
  const server = await openServer();
  const port = server.address().port;
  await new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companion/events`);
    socket.once("open", () => reject(new Error("unauthenticated socket opened")));
    socket.once("error", resolve);
  });
  events.close();
  server.close();
});

test("companion event hub authenticates and delivers verified proactive events", { concurrency: false }, async () => {
  const server = await openServer();
  const port = server.address().port;
  const received = new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/api/companion/events`, { headers: { "X-Companion-Key": "event-test-secret" } });
    socket.on("message", (raw) => {
      const event = JSON.parse(raw.toString());
      if (event.type === "connection_state") return;
      socket.close();
      resolve(event);
    });
    socket.once("error", reject);
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const result = events.publish({ type: "proactive_message", conversationId: "wa:test", payload: { text: "Hello from ARIA", reason: "test" } });
  assert.equal(result.delivered, 1);
  const event = await received;
  assert.equal(event.type, "proactive_message");
  assert.equal(event.payload.text, "Hello from ARIA");
  assert.ok(event.eventId);
  events.close();
  server.close();
});

test("event hub ignores unsupported event types", { concurrency: false }, () => {
  const result = events.publish({ type: "invented_event", payload: {} });
  assert.equal(result.ignored, true);
});
