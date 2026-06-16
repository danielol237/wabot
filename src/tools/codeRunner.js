const { exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const TEMP_DIR = path.join(__dirname, "../../temp");

async function runCode(code, lang = "js") {
  const id = uuidv4();
  lang = lang.toLowerCase().trim();

  return new Promise((resolve) => {
    let filePath, cmd;

    try {
      if (lang === "js" || lang === "javascript" || lang === "node") {
        filePath = path.join(TEMP_DIR, `${id}.js`);
        fs.writeFileSync(filePath, code);
        cmd = `node "${filePath}"`;
      } else if (lang === "py" || lang === "python" || lang === "python3") {
        filePath = path.join(TEMP_DIR, `${id}.py`);
        fs.writeFileSync(filePath, code);
        cmd = `python3 "${filePath}"`;
      } else if (lang === "sh" || lang === "bash") {
        filePath = path.join(TEMP_DIR, `${id}.sh`);
        fs.writeFileSync(filePath, code);
        cmd = `bash "${filePath}"`;
      } else {
        return resolve(`❌ Language not supported: ${lang}\nSupported: js, python, bash`);
      }

      // 10 second timeout for safety
      exec(cmd, { timeout: 10000, maxBuffer: 1024 * 100 }, (err, stdout, stderr) => {
        // Cleanup
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);

        if (err && !stdout) {
          return resolve(`❌ Error:\n${stderr || err.message}`);
        }

        const output = stdout || stderr || "(no output)";
        resolve(output.slice(0, 2000)); // cap at 2000 chars
      });
    } catch (e) {
      resolve(`❌ Failed to run: ${e.message}`);
    }
  });
}

module.exports = { runCode };
