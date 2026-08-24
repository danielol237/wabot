// ── Advanced Code Interpreter ──────────────────────────────
// !run <lang> <code> — executes code and returns output
// Supports JS, Python, Bash, HTML (as screenshot)

const { exec, execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP = path.join(__dirname, "../../temp");

async function interpret(language, code) {
  const id = uuidv4();
  const lang = language.toLowerCase().trim();

  if (lang === "js" || lang === "javascript" || lang === "node") {
    return runFile(id, code, "js", "node");
  }
  if (lang === "py" || lang === "python") {
    return runFile(id, code, "py", "python3");
  }
  if (lang === "sh" || lang === "bash") {
    return runFile(id, code, "sh", "bash");
  }
  if (lang === "html") {
    return renderHTML(id, code);
  }
  if (lang === "plot" || lang === "chart") {
    return runPlot(id, code);
  }

  return { success: false, output: "Unsupported language: " + lang + ". Use: js, py, sh, html, plot" };
}

function runFile(id, code, ext, cmd) {
  return new Promise((resolve) => {
    const filePath = path.join(TEMP, id + "." + ext);
    try { fs.mkdirSync(TEMP, { recursive: true }); fs.writeFileSync(filePath, code); }
    catch (err) { return resolve({ success: false, output: "Could not prepare code: " + err.message }); }
    execFile(cmd, [filePath], { timeout: 15000, maxBuffer: 1024 * 500 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      const output = stdout || stderr || err?.message || "(no output)";
      resolve({ success: !err, output: output.slice(0, 4000) });
    });
  });
}

function renderHTML(id, code) {
  return new Promise((resolve) => {
    const filePath = path.join(TEMP, id + ".html");
    fs.writeFileSync(filePath, code);
    resolve({
      success: true,
      output: "HTML saved. Open: " + filePath,
      html: code,
      filePath: filePath,
    });
  });
}

function runPlot(id, code) {
  return new Promise((resolve) => {
    const pyCode = `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
${code}
plt.savefig('/tmp/${id}_plot.png', dpi=100, bbox_inches='tight')
print('Plot saved')
`;
    const filePath = path.join(TEMP, id + "_plot.py");
    fs.writeFileSync(filePath, pyCode);
    exec('python3 "' + filePath + '"', { timeout: 30000 }, (err, stdout, stderr) => {
      try { fs.unlinkSync(filePath); } catch (_) {}
      const imagePath = "/tmp/" + id + "_plot.png";
      if (!err && fs.existsSync(imagePath)) {
        resolve({ success: true, output: "Plot generated!", image: imagePath });
      } else {
        resolve({ success: false, output: (stderr || err?.message || "Plot failed") });
      }
    });
  });
}

module.exports = { interpret };
