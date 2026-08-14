const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const express = require("express");

process.env.DASHBOARD_PASSWORD = process.env.DASHBOARD_PASSWORD || "atlas-dashboard-test-password";
process.env.OWNER_NUMBER = process.env.OWNER_NUMBER || "12345000000";
process.env.DASHBOARD_CSRF_SECRET = process.env.DASHBOARD_CSRF_SECRET || "atlas-dashboard-test-csrf";

const dashboard = require("../src/dashboard");

function request(server, pathname) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      host: "127.0.0.1",
      port: server.address().port,
      path: pathname,
      headers: { Authorization: "Basic " + Buffer.from("owner:" + process.env.DASHBOARD_PASSWORD).toString("base64") },
    }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => { body += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body }));
    });
    request.on("error", reject);
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
