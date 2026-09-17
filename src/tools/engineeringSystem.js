const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { generateCodingText } = require("./codingProvider");

const ROOT = path.join(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const PROPOSALS_FILE = path.join(DATA_DIR, "engineeringProposals.json");
const DEFAULT_REPOSITORY = "danielol237/wabot";
const DEFAULT_BRANCH = "main";
const MAX_FILES = 6;
const MAX_FILE_BYTES = 240000;
const PLAN_MAX_BYTES = 16000;
const ALLOWED_PATHS = ["src/", "plugins/", "test/", "package.json", "README.md", "HOSTING.md", ".env.example"];
const DENIED_PATHS = [".env", "data/", "auth_info_baileys/", "sessions/", "credentials/", ".github/workflows/", "node_modules/"];
const CODE_PROMPT = "You are ARIA's controlled code-change engine. Return only complete source-file content, with no markdown fences, explanations, secrets, credentials, shell commands, or destructive instructions. Preserve unrelated behavior and existing project conventions. Never create or modify environment secret files, WhatsApp session files, or deployment credentials.";
const PLAN_PROMPT = "You are ARIA's engineering planner. Return only valid JSON, with no markdown fences or commentary. Keep changes bounded, testable, reversible, and limited to the allowed repository paths. Do not request secrets, session files, production environment changes, direct main-branch writes, or self-merging.";

function clean(value, max = 1200) {
  return String(value || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function slugify(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 42) || "upgrade";
}

function repositoryName() {
  const value = String(process.env.ARIA_ENGINEERING_REPO || DEFAULT_REPOSITORY).trim();
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value) ? value : DEFAULT_REPOSITORY;
}

function githubToken() {
  return String(process.env.GITHUB_TOKEN || process.env.SESSION_GITHUB_TOKEN || "").trim();
}

function githubHeaders() {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ARIA-Wabot-Engineering",
  };
  const token = githubToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function hasGithubCredential() {
  return Boolean(githubToken());
}

function repoPath(endpoint) {
  return `https://api.github.com/repos/${repositoryName()}${endpoint}`;
}

async function githubRequest(method, endpoint, data = undefined, config = {}) {
  if (!hasGithubCredential()) throw new Error("GitHub engineering access is not configured in the runtime.");
  const response = await axios({
    method,
    url: repoPath(endpoint),
    data,
    headers: githubHeaders(),
    timeout: config.timeout || 20000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) {
    const detail = clean(response.data?.message || response.statusText || `HTTP ${response.status}`, 300);
    throw new Error(`GitHub API ${method} ${endpoint} failed: ${detail}`);
  }
  return response.data;
}

function safeRelativePath(input) {
  const value = String(input || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!value || value.includes("\0")) return null;
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../") || normalized.startsWith(".git/")) return null;
  if (DENIED_PATHS.some((prefix) => normalized === prefix.replace(/\/$/, "") || normalized.startsWith(prefix))) return null;
  if (!ALLOWED_PATHS.some((prefix) => prefix.endsWith("/") ? normalized.startsWith(prefix) : normalized === prefix)) return null;
  return normalized;
}

function loadProposals() {
  try {
    const parsed = JSON.parse(fs.readFileSync(PROPOSALS_FILE, "utf8"));
    return Array.isArray(parsed) ? parsed.slice(-40) : [];
  } catch (_) {
    return [];
  }
}

function saveProposals(proposals) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const safe = proposals.slice(-40).map((proposal) => ({
    ...proposal,
    files: (proposal.files || []).map((file) => ({
      path: file.path,
      description: file.description,
      status: file.status,
      content: file.content,
    })),
  }));
  fs.writeFileSync(PROPOSALS_FILE, JSON.stringify(safe, null, 2) + "\n", "utf8");
}

function getProposal(id) {
  return loadProposals().find((proposal) => proposal.id === String(id || "").trim()) || null;
}

function updateProposal(id, patch) {
  const proposals = loadProposals();
  const index = proposals.findIndex((proposal) => proposal.id === id);
  if (index < 0) return null;
  proposals[index] = { ...proposals[index], ...patch, updatedAt: Date.now() };
  saveProposals(proposals);
  return proposals[index];
}

function extractJson(text) {
  let cleaned = String(text || "").replace(/```json|```/gi, "").trim();
  const objectMatch = cleaned.match(/\{[\s\S]*\}/);
  if (objectMatch) cleaned = objectMatch[0];
  return JSON.parse(cleaned);
}

function normalizePlan(raw, objective) {
  const files = Array.isArray(raw?.files) ? raw.files.slice(0, MAX_FILES).map((file) => ({
    path: safeRelativePath(file?.path),
    description: clean(file?.description, 400),
  })).filter((file) => file.path && file.description) : [];
  if (!files.length) throw new Error("The engineering plan did not contain any allowed files.");
  return {
    summary: clean(raw.summary || objective, 800),
    objective: clean(objective, 800),
    files,
    tests: Array.isArray(raw.tests) ? raw.tests.map((item) => clean(item, 220)).filter(Boolean).slice(0, 8) : ["npm test"],
    risks: Array.isArray(raw.risks) ? raw.risks.map((item) => clean(item, 220)).filter(Boolean).slice(0, 8) : ["Generated code still requires review and CI."],
    rollback: clean(raw.rollback || "Close the pull request and revert the branch; main is not modified by this flow.", 500),
  };
}

async function createUpgradePlan(objective, senderName, chatId) {
  const request = clean(objective, 1200);
  if (!request) return { success: false, error: "Tell me what you want upgraded." };
  const prompt = `${request}\n\nRepository: ${repositoryName()}\nAllowed paths: ${ALLOWED_PATHS.join(", ")}\nForbidden paths: ${DENIED_PATHS.join(", ")}\n\nCreate a bounded plan with at most ${MAX_FILES} files. Include exact relative paths, a summary, tests, risks, and rollback. This is a proposal only; do not write code yet.`;
  try {
    const response = await generateCodingText(prompt, { system: PLAN_PROMPT, maxTokens: 6000, temperature: 0.1 });
    const plan = normalizePlan(extractJson(response), request);
    const proposal = {
      id: `upgrade_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      chatId: clean(chatId, 180),
      createdBy: clean(senderName, 120),
      state: "proposed",
      repository: repositoryName(),
      baseBranch: DEFAULT_BRANCH,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ...plan,
    };
    saveProposals([...loadProposals(), proposal]);
    return { success: true, proposal, message: formatProposal(proposal) };
  } catch (error) {
    return { success: false, error: `I could not produce a safe upgrade plan: ${clean(error.message, 300)}` };
  }
}

function formatProposal(proposal) {
  const files = (proposal.files || []).map((file) => `• *${file.path}* — ${file.description}`).join("\n");
  return `🧠 *Upgrade proposal ${proposal.id}*\n\n${proposal.summary}\n\n*Files in scope*\n${files}\n\n*Checks:* ${(proposal.tests || []).join(", ")}\n*Risks:* ${(proposal.risks || []).join("; ")}\n*Rollback:* ${proposal.rollback}\n\nNo files have been changed. Say *ARIA approve upgrade ${proposal.id}* to generate a branch and draft GitHub PR.`;
}

async function getRemoteFile(filePath, ref) {
  const data = await githubRequest("GET", `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`);
  if (Array.isArray(data) || !data?.content) throw new Error(`GitHub did not return file content for ${filePath}.`);
  return Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8");
}

async function generateUpgradeFile(file, objective, currentContent, senderName) {
  if (Buffer.byteLength(currentContent, "utf8") > MAX_FILE_BYTES) throw new Error(`${file.path} is too large for a bounded AI edit.`);
  const prompt = `Repository: ${repositoryName()}\nFile: ${file.path}\nObjective: ${objective}\nRequested file role: ${file.description}\n\nCurrent file content:\n${currentContent}\n\nReturn the complete updated content for this file. Make the smallest coherent change that fulfills the objective. Preserve unrelated code. Do not add secrets, raw tokens, shell scripts, self-deleting code, or changes outside this file.`;
  const response = await generateCodingText(prompt, { system: CODE_PROMPT, maxTokens: 16000, temperature: 0.12 });
  const content = String(response || "").replace(/^```[\w-]*\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!content || content.length > MAX_FILE_BYTES) throw new Error(`Generated content for ${file.path} was empty or too large.`);
  if (/-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|VERCEL_TOKEN\s*[:=]/i.test(content)) throw new Error(`Generated content for ${file.path} contained a credential-like value.`);
  return content;
}

async function createGitHubUpgrade(proposalId, senderName) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found or expired." };
  if (!["proposed", "ready"].includes(proposal.state)) return { success: false, error: `That upgrade is already ${proposal.state}.` };
  if (!hasGithubCredential()) return { success: false, error: "GitHub access is not configured. I did not generate or store any credential." };

  try {
    const ref = await githubRequest("GET", `/git/ref/heads/${encodeURIComponent(proposal.baseBranch)}`);
    const baseSha = ref?.object?.sha;
    if (!baseSha) throw new Error("The base branch has no readable commit SHA.");
    const commit = await githubRequest("GET", `/git/commits/${baseSha}`);
    const branch = `aria/${slugify(proposal.objective)}-${Date.now().toString(36)}`;
    const generatedFiles = [];
    for (const file of proposal.files) {
      const current = await getRemoteFile(file.path, proposal.baseBranch);
      const content = await generateUpgradeFile(file, proposal.objective, current, senderName);
      generatedFiles.push({ ...file, content, status: "generated" });
    }

    const treeEntries = [];
    for (const file of generatedFiles) {
      const blob = await githubRequest("POST", "/git/blobs", { content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" });
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await githubRequest("POST", "/git/trees", { base_tree: commit.tree.sha, tree: treeEntries });
    const newCommit = await githubRequest("POST", "/git/commits", {
      message: `aria: ${clean(proposal.objective, 160)}`,
      tree: tree.sha,
      parents: [baseSha],
    });
    await githubRequest("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: newCommit.sha });
    const pr = await githubRequest("POST", "/pulls", {
      title: `aria: ${clean(proposal.objective, 160)}`,
      head: branch,
      base: proposal.baseBranch,
      body: `## ARIA engineering proposal\\n\\n${proposal.summary}\\n\\n### Files\\n${generatedFiles.map((file) => `- ${file.path}: ${file.description}`).join("\\n")}\\n\\n### Required checks\\n${(proposal.tests || []).map((test) => `- ${test}`).join("\\n")}\\n\\n### Safety\\n- Generated in a bounded allowlist.\\n- No direct write to main.\\n- Review and CI are required before merge.\\n- Rollback: ${proposal.rollback}`,
      draft: true,
    });
    const updated = updateProposal(proposal.id, { state: "pr_open", branch, commitSha: newCommit.sha, prNumber: pr.number, prUrl: pr.html_url, files: generatedFiles });
    return { success: true, proposal: updated, message: `✅ I created a draft GitHub PR without touching main.\n\nPR: ${pr.html_url}\nBranch: ${branch}\nCommit: ${newCommit.sha.slice(0, 12)}\n\nRun the requested checks, then say *ARIA verify upgrade ${proposal.id}*.` };
  } catch (error) {
    updateProposal(proposal.id, { state: "blocked", error: clean(error.message, 500) });
    return { success: false, error: `The upgrade was blocked before completion: ${clean(error.message, 500)}` };
  }
}

async function mergeUpgrade(proposalId) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found." };
  if (proposal.state !== "verified" || proposal.ciState !== "success") return { success: false, error: "This upgrade is not verified green yet. Run verification and wait for successful checks before merging." };
  if (!proposal.prNumber || !proposal.branch) return { success: false, error: "This proposal has no mergeable GitHub pull request." };
  try {
    const current = await githubRequest("GET", `/pulls/${proposal.prNumber}`);
    if (current.merged) return { success: false, error: "That pull request is already merged." };
    if (current.base?.ref !== DEFAULT_BRANCH || current.head?.ref !== proposal.branch) return { success: false, error: "The pull request target changed, so I blocked the merge." };
    if (current.draft) await githubRequest("PATCH", `/pulls/${proposal.prNumber}`, { draft: false });
    const merged = await githubRequest("PUT", `/pulls/${proposal.prNumber}/merge`, { merge_method: "squash", commit_title: `aria: ${clean(proposal.objective, 120)}` });
    if (!merged.merged) return { success: false, error: clean(merged.message || "GitHub did not merge the pull request.", 400) };
    const updated = updateProposal(proposal.id, { state: "merged", mergedSha: merged.sha || null, mergedAt: Date.now() });
    return { success: true, proposal: updated, message: `✅ Upgrade ${proposal.id} merged into ${DEFAULT_BRANCH}.\n\n${proposal.prUrl || `PR #${proposal.prNumber}`}\nMerge SHA: ${(merged.sha || "unknown").slice(0, 12)}\n\nRender can now deploy the new main revision through its normal connected-repository workflow.` };
  } catch (error) {
    return { success: false, error: `The merge was blocked: ${clean(error.message, 500)}` };
  }
}

async function verifyUpgrade(proposalId) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found." };
  if (!proposal.prNumber || !proposal.commitSha) return { success: false, error: "This proposal has no GitHub PR to verify yet." };
  try {
    const pr = await githubRequest("GET", `/pulls/${proposal.prNumber}`);
    const status = await githubRequest("GET", `/commits/${proposal.commitSha}/status`);
    const checks = await githubRequest("GET", `/commits/${proposal.commitSha}/check-runs`, { }, { timeout: 20000 });
    const conclusions = (checks.check_runs || []).map((check) => `${check.name}: ${check.conclusion || check.status}`).join(", ");
    const verified = status.state === "success" && (checks.total_count === 0 || (checks.check_runs || []).every((check) => check.conclusion === "success"));
    const updated = updateProposal(proposal.id, { state: verified ? "verified" : "pr_open", ciState: status.state, checks: conclusions });
    return { success: true, verified, proposal: updated, message: `${verified ? "✅" : "⏳"} Upgrade ${proposal.id}\nPR: ${pr.html_url}\nGitHub status: ${status.state}\nChecks: ${conclusions || "No completed check runs reported yet."}\n\n${verified ? "The PR is verified and ready for your review/merge." : "The PR is not verified yet; I will not recommend merging it."}` };
  } catch (error) {
    return { success: false, error: `Verification could not complete: ${clean(error.message, 400)}` };
  }
}

function inspectSystem() {
  const packageJson = (() => { try { return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")); } catch (_) { return {}; } })();
  const countFiles = (relative, extension = null) => {
    const dir = path.join(ROOT, relative);
    try { return fs.readdirSync(dir).filter((name) => !extension || name.endsWith(extension)).length; } catch (_) { return 0; }
  };
  const commandRouter = (() => { try { return fs.readFileSync(path.join(ROOT, "src/utils/commandRouter.js"), "utf8"); } catch (_) { return ""; } })();
  const commandCount = (commandRouter.match(/registerCommand\(\{/g) || []).length;
  const configured = (name) => Boolean(process.env[name]);
  return {
    repository: repositoryName(),
    runtime: process.version,
    commandCount,
    pluginCount: countFiles("plugins", ".js"),
    toolCount: countFiles("src/tools", ".js"),
    providers: {
      gpt5: true,
      minimax: configured("MINIMAX_API_KEY"),
      zai: configured("ZHIPU_API_KEY"),
      gemini: configured("GEMINI_API_KEY"),
      groq: configured("GROQ_API_KEY"),
      cerebras: configured("CEREBRAS_API_KEY"),
      openrouter: configured("OPENROUTER_API_KEY"),
      githubEngineering: hasGithubCredential(),
      vercelDeployment: configured("VERCEL_TOKEN"),
    },
    controls: {
      directMainWrites: false,
      pullRequestRequired: true,
      productionDeploymentRequiresExplicitMode: true,
      secretsReadFromEnvironmentOnly: true,
      buildWorkspaceIsolated: true,
    },
  };
}

function formatInspection(report) {
  const providers = Object.entries(report.providers).map(([name, enabled]) => `• ${name}: ${enabled ? "configured/available" : "not configured"}`).join("\n");
  return `🧩 *ARIA system inventory*\n\nRepository: ${report.repository}\nRuntime: ${report.runtime}\nRegistered commands: ${report.commandCount}\nPlugins: ${report.pluginCount}\nTools: ${report.toolCount}\n\n*AI/integration availability*\n${providers}\n\n*Safety controls*\n• Direct main writes: ${report.controls.directMainWrites ? "enabled" : "blocked"}\n• Pull request required: ${report.controls.pullRequestRequired ? "yes" : "no"}\n• Production deployment: ${report.controls.productionDeploymentRequiresExplicitMode ? "explicit mode required" : "automatic"}\n• Secrets: environment-only\n• Generated builds: isolated workspace`;
}

function listProposals() {
  return loadProposals().slice(-8).reverse().map((proposal) => `${proposal.id} — ${proposal.state} — ${proposal.objective}${proposal.prUrl ? ` — ${proposal.prUrl}` : ""}`).join("\n") || "No engineering proposals recorded.";
}

async function handleEngineeringRequest(rawInput, senderName, chatId) {
  const raw = clean(rawInput, 1400);
  const lower = raw.toLowerCase();
  if (!raw || /^(?:status|inspect|inventory|modules|capabilities|what can you do|what modules)/i.test(raw)) return { success: true, message: formatInspection(inspectSystem()), report: inspectSystem() };
  const id = raw.match(/\b(upgrade_[a-z0-9_]+)\b/i)?.[1];
  if (/^(?:list|show)\s+(?:upgrades|proposals|engineering)/i.test(raw)) return { success: true, message: `🧾 *Recent engineering proposals*\n\n${listProposals()}` };
  if (/^merge\b/i.test(raw) && id) return mergeUpgrade(id);
  if (/^(?:approve|apply|execute)\b/i.test(raw)) return createGitHubUpgrade(id || raw.split(/\s+/)[1], senderName);
  if (/^(?:verify|check|test)\b/i.test(raw) && id) return verifyUpgrade(id);
  const objective = raw.replace(/^(?:plan|propose|implement|upgrade|improve|build|add|change|fix)\s*/i, "").trim() || raw;
  return createUpgradePlan(objective, senderName, chatId);
}

module.exports = {
  createUpgradePlan,
  createGitHubUpgrade,
  verifyUpgrade,
  mergeUpgrade,
  inspectSystem,
  formatInspection,
  listProposals,
  handleEngineeringRequest,
  _test: { safeRelativePath, normalizePlan, slugify, repositoryName },
};
