const fs = require("fs");
const path = require("path");

const TEXT_EXTENSIONS = /\.(?:html?|css|js|jsx|ts|tsx|json|md)$/i;
const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|gif|svg|webp|avif)$/i;
const PLACEHOLDER_RE = /lorem ipsum|your (?:brand|company|logo)|company name|example\.com|replace (?:this|me)|build something great|coming soon|dummy text|insert (?:text|copy) here/i;

function read(projectDir, file) {
  try { return fs.readFileSync(path.join(projectDir, file), "utf8"); } catch (_) { return null; }
}
function issue(list, file, message, blocking = false) { list.push({ file, issue: message, blocking }); }

function checkHtml(projectDir, file, html, blocking, warnings) {
  if (!/<html\b/i.test(html)) return;
  if (!/<html[^>]*\blang\s*=\s*["'][^"']+["']/i.test(html)) issue(blocking, file, "HTML document is missing a language attribute.", true);
  if (!/<meta[^>]+name\s*=\s*["']viewport["']/i.test(html)) issue(blocking, file, "Responsive page is missing a viewport meta tag.", true);
  if (!/<title>[^<\S]*[^<]+<\/title>/i.test(html)) issue(blocking, file, "HTML document is missing a non-empty title.", true);
  if (!/<meta[^>]+name\s*=\s*["']description["'][^>]+content\s*=\s*["'][^"']+\S["']/i.test(html)) issue(warnings, file, "HTML document is missing a useful meta description.");

  for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
    if (!/\balt\s*=\s*["'][^"']*["']/i.test(match[1])) issue(blocking, file, "Image is missing an alt attribute.", true);
  }
  for (const match of html.matchAll(/<(?:button|input|select|textarea)\b([^>]*)>/gi)) {
    const attrs = match[1];
    if (/\bbutton\b/i.test(match[0]) && !/\btype\s*=/.test(attrs)) issue(warnings, file, "Button has no explicit type; it may submit a surrounding form unexpectedly.");
    if (/^(?:input|select|textarea)/i.test(match[0]) && !/\b(?:aria-label|id\s*=)/i.test(attrs)) issue(warnings, file, "Form control has neither an accessible label hint nor an id for a label.");
  }
  for (const match of html.matchAll(/\b(?:href|action)\s*=\s*["']([^"']*)["']/gi)) {
    const target = match[1];
    if (/^#/i.test(target)) {
      const id = target.slice(1);
      if (id && !new RegExp(`\\bid=["']${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(html)) issue(warnings, file, `In-page navigation target "${target}" does not match an element id.`);
    } else if (/^javascript:/i.test(target)) issue(warnings, file, `Navigation target "${target}" is script-based and should be replaced with a real interaction.`);
  }
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const target = match[1].split(/[?#]/)[0];
    if (/^(?:https?:|data:|mailto:|tel:|#|\/)/i.test(target)) continue;
    if (!fs.existsSync(path.join(projectDir, path.dirname(file), target))) issue(blocking, file, `Referenced local asset does not exist: ${target}.`, true);
  }
}

function checkCss(projectDir, file, css, blocking, warnings) {
  if (/\.body\s*\{|\.html\s*\{|\.head\s*\{/i.test(css)) issue(blocking, file, "CSS uses a class selector where an HTML element selector appears intended.", true);
  if (/@media\s*\(/i.test(css) === false && css.length > 1200) issue(warnings, file, "Large stylesheet has no responsive media query.");
  for (const match of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) {
    const target = match[1].split(/[?#]/)[0];
    if (/^(?:https?:|data:|#|\/)/i.test(target)) continue;
    if (!fs.existsSync(path.join(projectDir, path.dirname(file), target))) issue(blocking, file, `Referenced local CSS asset does not exist: ${target}.`, true);
  }
}

function checkProject(projectDir, files) {
  const blocking = [];
  const warnings = [];
  const textFiles = (files || []).filter((file) => TEXT_EXTENSIONS.test(file));
  const htmlFiles = textFiles.filter((file) => /\.html?$/i.test(file));
  const cssFiles = textFiles.filter((file) => /\.css$/i.test(file));
  const jsFiles = textFiles.filter((file) => /\.(?:js|jsx|ts|tsx)$/i.test(file));

  for (const file of textFiles) {
    const content = read(projectDir, file);
    if (content === null) { issue(blocking, file, "Planned source file is missing from the generated project.", true); continue; }
    if (PLACEHOLDER_RE.test(content)) issue(blocking, file, "Generated content contains placeholder or generic starter copy.", true);
    if (/AI request failed on all providers|provider failure/i.test(content.slice(0, 5000))) issue(blocking, file, "Generated file contains an AI-provider failure instead of project content.", true);
  }
  for (const file of htmlFiles) { const html = read(projectDir, file); if (html) checkHtml(projectDir, file, html, blocking, warnings); }
  for (const file of cssFiles) { const css = read(projectDir, file); if (css) checkCss(projectDir, file, css, blocking, warnings); }
  for (const file of (files || []).filter((item) => IMAGE_EXTENSIONS.test(item))) {
    const full = path.join(projectDir, file);
    try {
      const data = fs.readFileSync(full);
      const valid = /\.png$/i.test(file) ? data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : /\.jpe?g$/i.test(file) ? data.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
        : /\.gif$/i.test(file) ? data.subarray(0, 4).toString() === "GIF8"
        : /\.webp$/i.test(file) ? data.subarray(0, 4).toString() === "RIFF" && data.subarray(8, 12).toString() === "WEBP"
        : /\.svg$/i.test(file) ? /<svg\b/i.test(data.toString("utf8", 0, 1000))
        : data.length > 32;
      if (!valid) issue(blocking, file, "Image asset is not valid for its file extension and may be a text placeholder.", true);
    } catch (err) { issue(blocking, file, `Image asset could not be read: ${err.message}.`, true); }
  }

  const allHtml = htmlFiles.map((file) => read(projectDir, file) || "").join("\n");
  const allCss = cssFiles.map((file) => read(projectDir, file) || "").join("\n");
  const allJs = jsFiles.map((file) => read(projectDir, file) || "").join("\n");
  const htmlClasses = new Set([...allHtml.matchAll(/class\s*=\s*["']([^"']+)["']/gi)].flatMap((m) => m[1].split(/\s+/)).filter(Boolean));
  const cssClasses = new Set([...allCss.matchAll(/\.([a-zA-Z][\w-]*)\s*(?:[,:{])/g)].map((m) => m[1]));
  const missingCss = [...htmlClasses].filter((name) => !cssClasses.has(name) && !/^(?:active|hidden|show|container|row|col|icon|nav|menu)$/i.test(name));
  if (missingCss.length) issue(blocking, cssFiles[0] || htmlFiles[0] || "project", `HTML classes have no matching CSS selectors: ${missingCss.slice(0, 8).join(", ")}.`, true);

  for (const match of allJs.matchAll(/getElementById\s*\(\s*["']([^"']+)["']/g)) {
    const selector = match[1];
    if (/\$\{|[^a-zA-Z0-9_-]/.test(selector)) continue;
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!new RegExp(`\\bid=["']${escaped}["']`, "i").test(allHtml)) issue(blocking, jsFiles[0] || "project", `JavaScript targets missing DOM selector "#${selector}".`, true);
  }
  for (const match of allJs.matchAll(/querySelector(?:All)?\s*\(\s*["']([.#])([a-zA-Z][\w-]*)["']/g)) {
    const prefix = match[1];
    const selector = match[2];
    const exists = prefix === "." ? htmlClasses.has(selector) : new RegExp(`\\bid=["']${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i").test(allHtml);
    if (!exists) issue(blocking, jsFiles[0] || "project", `JavaScript targets missing DOM selector "${prefix}${selector}".`, true);
  }

  if (htmlFiles.length && !/<meta[^>]+property\s*=\s*["']og:title["']/i.test(allHtml)) issue(warnings, htmlFiles[0], "No Open Graph title metadata was found.");
  if (htmlFiles.length && !/<main\b/i.test(allHtml)) issue(warnings, htmlFiles[0], "No main landmark was found in the HTML.");
  return { blocking, warnings, all: [...blocking, ...warnings] };
}

module.exports = { checkProject, PLACEHOLDER_RE };
