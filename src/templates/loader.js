// Template loader — loads project templates from files instead of hardcoding
// them inside coding providers. Add a new template by creating a folder under
// src/templates/ with at minimum an index.html.

const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = __dirname;

// Template definitions with match patterns and setup functions
const TEMPLATES = {
  landing: {
    name: "Landing Page",
    match: ["landing page", "landing", "startup page", "product page"],
    files: ["index.html", "style.css"],
  },
  todo: {
    name: "Todo App",
    match: ["todo", "to-do", "task list", "task manager"],
    files: ["index.html", "style.css", "script.js"],
  },
};

function loadTemplate(key, destDir) {
  const tmpl = TEMPLATES[key];
  if (!tmpl) return false;

  const tmplDir = path.join(TEMPLATES_DIR, key);
  if (!fs.existsSync(tmplDir)) return false;

  let hasIndex = false;
  for (const file of tmpl.files) {
    const src = path.join(tmplDir, file);
    if (fs.existsSync(src)) {
      const content = fs.readFileSync(src, "utf-8");
      fs.writeFileSync(path.join(destDir, file), content);
      if (file === "index.html") hasIndex = true;
    }
  }
  return hasIndex;
}

function matchTemplate(request) {
  const lower = request.toLowerCase();
  for (const [key, tmpl] of Object.entries(TEMPLATES)) {
    if (tmpl.match.some(m => lower.includes(m))) {
      return key;
    }
  }
  return null;
}

function getTemplateNames() {
  return Object.keys(TEMPLATES);
}

module.exports = { loadTemplate, matchTemplate, getTemplateNames, TEMPLATES };
