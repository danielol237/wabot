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
      Authorization: "Basic " + Buffer.from("owner:" + process.env.DASHBOARD_PASSWORD).toString("base64"),
      ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
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
    assert.match(page.body, /North Star|Give ARIA a project/);
    const api = await request(server, "/dashboard/api/atlas");
    assert.equal(api.status, 200);
    assert.match(api.body, /workspaces/);
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
