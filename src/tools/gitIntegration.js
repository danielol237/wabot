// ── GitHub Integration ──────────────────────────────────────
// !github repo <name> — repo info
// !github commit <msg> — commit all changes (needs git repo)
// !github push — push current branch
// !github pr — create PR

const axios = require("axios");
const { exec } = require("child_process");
const path = require("path");

const BASE = "https://api.github.com";
const REPO = "danielol237/wabot";
const GIT_DIR = path.join(__dirname, "../..");

let token = process.env.GITHUB_TOKEN || "";

function getHeaders() {
  const h = { Accept: "application/vnd.github.v3+json" };
  if (token) h.Authorization = "token " + token;
  return h;
}

async function repoInfo(owner, repoName) {
  try {
    const r = await axios.get(`${BASE}/repos/${owner || "danielol237"}/${repoName || "wabot"}`, { headers: getHeaders(), timeout: 10000 });
    const d = r.data;
    return {
      name: d.full_name,
      desc: d.description || "No description",
      stars: d.stargazers_count,
      forks: d.forks_count,
      issues: d.open_issues_count,
      lang: d.language,
      url: d.html_url,
    };
  } catch (e) {
    return { error: e.message };
  }
}

async function listPRs(owner, repoName, state = "open") {
  try {
    const r = await axios.get(`${BASE}/repos/${owner || "danielol237"}/${repoName || "wabot"}/pulls?state=${state}&per_page=5`, { headers: getHeaders(), timeout: 10000 });
    return r.data.map(pr => ({
      number: pr.number,
      title: pr.title,
      user: pr.user?.login,
      state: pr.state,
      url: pr.html_url,
    }));
  } catch (e) {
    return [];
  }
}

async function listCommits(owner, repoName, perPage = 5) {
  try {
    const r = await axios.get(`${BASE}/repos/${owner || "danielol237"}/${repoName || "wabot"}/commits?per_page=${perPage}`, { headers: getHeaders(), timeout: 10000 });
    return r.data.map(c => ({
      message: c.commit.message.split("\n")[0],
      author: c.commit.author?.name,
      date: c.commit.author?.date?.slice(0, 10),
      url: c.html_url,
    }));
  } catch (e) {
    return [];
  }
}

// Run git commands locally
function runGit(args) {
  return new Promise((resolve) => {
    exec(`cd "${GIT_DIR}" && git ${args} 2>&1`, { timeout: 15000 }, (err, stdout) => {
      if (err) resolve({ error: err.message, output: stdout });
      else resolve({ output: stdout.trim() });
    });
  });
}

module.exports = { repoInfo, listPRs, listCommits, runGit, setToken: (t) => { token = t; } };
