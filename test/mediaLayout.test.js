const test = require("node:test");
const assert = require("node:assert/strict");
const { mediaLayout, svgIcon } = require("../src/tools/mediaLayout");

test("mediaLayout renders desktop and mobile navigation shell", () => {
  const html = mediaLayout("Test Title", "home", "<p>Hello Media</p>");
  assert.ok(html.includes("ARIA"));
  assert.ok(html.includes("MEDIA"));
  assert.ok(html.includes("/aria-mark.png"));
  assert.ok(html.includes("Hello Media"));
  assert.ok(html.includes("mobile-bottom-nav"));
});

test("svgIcon returns correct SVG content", () => {
  const icon = svgIcon("home");
  assert.ok(icon.includes("<svg"));
});
