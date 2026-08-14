const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "atlas-dashboard-test-password";
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || "12345000000";
process.env.DASHBOARD_CSRF_SECRET = process.env.DASHBOARD_CSRF_SECRET || "atlas-dashboard-test-csrf";

const dashboard = require("../src/dashboard");
const atlas = require("../src/tools/atlasStore");

function request(server, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body === undefined ? null : JSON.stringify(options.body);
    const headers = {
      ...(options.auth === false ? {} : { Authorization: "Basic " + Buffer.from("owner:" + process.env.DASHBOARD_PASSWORD).toString("base64") }),
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
      ...(options.headers || {}),
    };
    const request = http.request({ host: "127.0.0.1", port: server.address().port, path: pathname, method: options.method || "GET", headers }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { text += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: text, json: () => JSON.parse(text) }));
    });
    request.on("error", reject);
    if (body) request.write(body);
    request.end();
  });
}

test("Atlas dashboard page and API are owner-authenticated and render", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const page = await request(server, "/dashboard/atlas");
    assert.equal(page.status, 200);
    assert.match(page.body, /PROJECT BRAIN/);
    assert.match(page.body, /NORTH STAR|Select or create a project/);
    assert.match(page.body, /Private operator workspace/);
    assert.match(page.body, /mobile-nav/);
    assert.match(page.body, /atlas-layout/);
    assert.match(page.body, /dashboardJson/);
    assert.match(page.body, /Dashboard session expired/);
    assert.match(page.body, /Integration health/);
    assert.match(page.body, /Recent deliveries/);
    const unauthenticatedApi = await request(server, "/dashboard/api/atlas", { auth: false, headers: { Accept: "application/json" } });
    assert.equal(unauthenticatedApi.status, 401);
    assert.equal(unauthenticatedApi.json().code, "auth_required");
    const api = await request(server, "/dashboard/api/atlas");
    assert.equal(api.status, 200);
    assert.match(api.body, /workspaces/);
    const missionsPage = await request(server, "/dashboard?pane=missions");
    assert.equal(missionsPage.status, 200);
    assert.match(missionsPage.body, /INITIAL_PANE=\"missions\"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Atlas dashboard plan API requires CSRF and applies an explicit reviewed roadmap", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrfResponse = await request(server, "/dashboard/api/csrf");
    assert.equal(csrfResponse.status, 200);
    const csrf = csrfResponse.json().csrf;
    const unauthorized = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "blocked", _csrf: "wrong" } });
    assert.equal(unauthorized.status, 403);
    assert.equal(unauthorized.json().code, "csrf_invalid");
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Dashboard plan project", outcome: "Ship the next Atlas slice", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;
    const draft = await request(server, `/dashboard/api/atlas/${workspaceId}/plan`, { method: "POST", body: { action: "draft", _csrf: csrf } });
    assert.equal(draft.status, 201);
    assert.equal(draft.json().draft.milestones.length, 4);
    const applied = await request(server, `/dashboard/api/atlas/${workspaceId}/plan`, { method: "POST", body: { action: "apply", _csrf: csrf } });
    assert.equal(applied.status, 200);
    assert.equal(applied.json().ok, true);
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Atlas dashboard exposes Sentinel state and keeps signal resolution owner-controlled", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrf = (await request(server, "/dashboard/api/csrf")).json().csrf;
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Sentinel dashboard project", outcome: "Observe delivery health", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;
    const enabled = await request(server, `/dashboard/api/atlas/${workspaceId}/sentinel`, { method: "POST", body: { action: "enable", githubRepository: "danielol237/wabot", _csrf: csrf } });
    assert.equal(enabled.status, 200);
    assert.equal(enabled.json().sentinel.enabled, true);
    assert.equal(enabled.json().sentinel.health.github.status, "attention");
    const diagnosed = await request(server, `/dashboard/api/atlas/${workspaceId}/sentinel`, { method: "POST", body: { action: "diagnose", _csrf: csrf } });
    assert.equal(diagnosed.status, 200);
    assert.equal(diagnosed.json().diagnostics.sources[0].source, "github");
    const selfTest = await request(server, `/dashboard/api/atlas/${workspaceId}/sentinel`, { method: "POST", body: { action: "self_test", _csrf: csrf } });
    assert.equal(selfTest.status, 200);
    assert.equal(typeof selfTest.json().selfTest.pass, "boolean");
    const owner = process.env.OWNER_NUMBER.includes("@") ? process.env.OWNER_NUMBER : process.env.OWNER_NUMBER + "@s.whatsapp.net";
    const sentinel = require("../src/tools/atlasSentinel");
    const signal = sentinel.ingestGithub(owner, { action: "completed", check_run: { conclusion: "failure" }, repository: { full_name: "danielol237/wabot" } }, "check_run", "dashboard-sentinel-1");
    const state = await request(server, `/dashboard/api/atlas/${workspaceId}/sentinel`);
    assert.equal(state.status, 200);
    assert.equal(state.json().signals.length, 1);
    const resolved = await request(server, `/dashboard/api/atlas/${workspaceId}/sentinel`, { method: "POST", body: { action: "resolve", id: signal.signal.id, _csrf: csrf } });
    assert.equal(resolved.status, 200);
    assert.equal(resolved.json().signal.status, "resolved");
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Atlas dashboard execution cockpit is owner-authenticated and CSRF-protected", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrf = (await request(server, "/dashboard/api/csrf")).json().csrf;
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Execution cockpit project", outcome: "Operate safely", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;
    const owner = process.env.OWNER_NUMBER.includes("@") ? process.env.OWNER_NUMBER : process.env.OWNER_NUMBER + "@s.whatsapp.net";
    const execution = require("../src/tools/atlasExecution");
    const run = execution.createExecution(owner, workspaceId, { lane: "build", objective: "Build safely" });
    const waiting = execution.beginExecution(owner, workspaceId, run.id);
    assert.equal(waiting.requiresApproval, true);

    const page = await request(server, `/dashboard/atlas?workspace=${workspaceId}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Execution lanes/);
    assert.match(page.body, /Retrospectives/);
    assert.match(page.body, /executionAction/);

    const unauthenticated = await request(server, `/dashboard/api/atlas/${workspaceId}/execution`, { auth: false, headers: { Accept: "application/json" } });
    assert.equal(unauthenticated.status, 401);
    const state = await request(server, `/dashboard/api/atlas/${workspaceId}/execution`);
    assert.equal(state.status, 200);
    assert.equal(state.json().executions[0].id, run.id);

    const noCsrf = await request(server, `/dashboard/api/atlas/${workspaceId}/execution`, { method: "POST", body: { action: "approve", id: run.id, _csrf: "wrong" } });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json().code, "csrf_invalid");

    const approved = await request(server, `/dashboard/api/atlas/${workspaceId}/execution`, { method: "POST", body: { action: "approve", id: run.id, _csrf: csrf } });
    assert.equal(approved.status, 200);
    assert.equal(approved.json().run.state, "running");

    const retro = await request(server, `/dashboard/api/atlas/${workspaceId}/execution`, { method: "POST", body: { action: "retrospect", id: run.id, outcome: "Safe approval path verified.", _csrf: csrf } });
    assert.equal(retro.status, 200);
    assert.equal(retro.json().retrospective.executionId, run.id);
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Atlas dashboard renders Operator Teams and protects team actions", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrf = (await request(server, "/dashboard/api/csrf")).json().csrf;
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Operator team cockpit", outcome: "Coordinate specialist work", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;
    const owner = process.env.OWNER_NUMBER.includes("@") ? process.env.OWNER_NUMBER : process.env.OWNER_NUMBER + "@s.whatsapp.net";
    const teams = require("../src/tools/atlasOperatorTeams");
    const team = teams.createOperatorTeam(owner, workspaceId, { objective: "Coordinate specialist work", roles: ["designer"] });

    const page = await request(server, `/dashboard/atlas?workspace=${workspaceId}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Operator Teams/);
    assert.match(page.body, /Latest team handoff/);
    assert.match(page.body, /operatorTeamAction/);

    const unauthenticated = await request(server, `/dashboard/api/atlas/${workspaceId}/operator-teams`, { auth: false, headers: { Accept: "application/json" } });
    assert.equal(unauthenticated.status, 401);
    const state = await request(server, `/dashboard/api/atlas/${workspaceId}/operator-teams`);
    assert.equal(state.status, 200);
    assert.equal(state.json().teams[0].id, team.id);

    const noCsrf = await request(server, `/dashboard/api/atlas/${workspaceId}/operator-teams`, { method: "POST", body: { action: "start", _csrf: "wrong" } });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json().code, "csrf_invalid");
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Atlas dashboard renders V7 Knowledge Graph and Artifact Vault safely", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrf = (await request(server, "/dashboard/api/csrf")).json().csrf;
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Knowledge cockpit", outcome: "Trace project context", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;

    const page = await request(server, `/dashboard/atlas?workspace=${workspaceId}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Knowledge Graph/);
    assert.match(page.body, /Artifact Vault/);
    assert.match(page.body, /knowledgeAction/);

    const unauthenticated = await request(server, `/dashboard/api/atlas/${workspaceId}/knowledge`, { auth: false, headers: { Accept: "application/json" } });
    assert.equal(unauthenticated.status, 401);
    const state = await request(server, `/dashboard/api/atlas/${workspaceId}/knowledge`);
    assert.equal(state.status, 200);
    assert.equal(typeof state.json().summary.revision, "number");

    const noCsrf = await request(server, `/dashboard/api/atlas/${workspaceId}/knowledge`, { method: "POST", body: { action: "project", _csrf: "wrong" } });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json().code, "csrf_invalid");
    const projected = await request(server, `/dashboard/api/atlas/${workspaceId}/knowledge`, { method: "POST", body: { action: "project", _csrf: csrf } });
    assert.equal(projected.status, 200);
    assert.equal(projected.json().ok, true);
    assert.equal(projected.json().action, "project");
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});


test("Atlas dashboard renders and protects V8 Connected Delivery controls", async () => {
  const app = express();
  app.use(express.json({ limit: "256kb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use("/dashboard", dashboard);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  let workspaceId = null;
  try {
    const csrf = (await request(server, "/dashboard/api/csrf")).json().csrf;
    const created = await request(server, "/dashboard/api/atlas/workspaces", { method: "POST", body: { title: "Connected delivery cockpit", outcome: "Observe GitHub and Render safely", _csrf: csrf } });
    assert.equal(created.status, 201);
    workspaceId = created.json().id;

    const page = await request(server, `/dashboard/atlas?workspace=${workspaceId}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Connected Delivery/);
    assert.match(page.body, /deliveryAction/);
    assert.match(page.body, /verified awareness/);

    const unauthenticated = await request(server, `/dashboard/api/atlas/${workspaceId}/connected-delivery`, { auth: false, headers: { Accept: "application/json" } });
    assert.equal(unauthenticated.status, 401);
    const initial = await request(server, `/dashboard/api/atlas/${workspaceId}/connected-delivery`);
    assert.equal(initial.status, 200);
    assert.equal(initial.json().connected.status, "not_configured");

    const noCsrf = await request(server, `/dashboard/api/atlas/${workspaceId}/connected-delivery`, { method: "POST", body: { action: "map", repository: "danielol237/wabot", serviceId: "srv-demo", _csrf: "wrong" } });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.json().code, "csrf_invalid");

    const mapped = await request(server, `/dashboard/api/atlas/${workspaceId}/connected-delivery`, { method: "POST", body: { action: "map", repository: "danielol237/wabot", serviceId: "srv-demo", _csrf: csrf } });
    assert.equal(mapped.status, 200);
    assert.equal(mapped.json().connected.mapping.github, "danielol237/wabot");
    assert.equal(mapped.json().connected.mapping.render, "srv-demo");
    assert.match(mapped.json().message, /no provider setting was changed/i);
  } finally {
    if (workspaceId) {
      try { require("fs").rmSync(require("path").join(atlas.ATLAS_DIR, workspaceId + ".json"), { force: true }); } catch (_) {}
    }
    await new Promise((resolve) => server.close(resolve));
  }
});
