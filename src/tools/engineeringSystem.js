const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const { generateCodingText } = require("./codingProvider");
const githubCredentialVault = require("./githubCredentialVault");

const ROOT = path.join(__dirname, "../..");
const DATA_DIR = path.join(ROOT, "data");
const PROPOSALS_FILE = path.join(DATA_DIR, "engineeringProposals.json");
const DEFAULT_REPOSITORY = "danielol237/wabot";
const DEFAULT_BRANCH = "main";
const MAX_FILES = 6;
const MAX_FILE_BYTES = 240000;
const PLAN_MAX_BYTES = 16000;
const ALLOWED_PATHS = ["src/", "plugins/", "test/", "app/", "gradle/", "package.json", "README.md", "HOSTING.md", ".env.example", "settings.gradle.kts", "build.gradle.kts", "gradle.properties"];
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

function repositoryFromRequest(input, actorJid) {
  const request = String(input || "").toLowerCase();
  const match = request.match(/\b([a-z0-9_.-]+\/[a-z0-9_.-]+)\b/);
  if (match && /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/.test(match[1])) return match[1];
  return githubCredentialVault.getWorkspaceForUser(actorJid) || null;
}

function githubToken(actorJid) {
  if (actorJid) return String(githubCredentialVault.getTokenForUser(actorJid) || "").trim();
  return String(process.env.GITHUB_TOKEN || process.env.SESSION_GITHUB_TOKEN || "").trim();
}

function githubHeaders(actorJid) {
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "ARIA-Wabot-Engineering",
  };
  const token = githubToken(actorJid);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function hasGithubCredential(actorJid) {
  if (actorJid) return Boolean(githubCredentialVault.getTokenForUser(actorJid));
  return Boolean(process.env.GITHUB_TOKEN || process.env.SESSION_GITHUB_TOKEN);
}

function repoPath(endpoint, repository = repositoryName()) {
  return `https://api.github.com/repos/${repository}${endpoint}`;
}

async function githubRequest(method, endpoint, data = undefined, config = {}) {
  if (!hasGithubCredential(config.actorJid)) throw new Error("GitHub access is not configured for this WhatsApp user. Send your GitHub token privately to ARIA first.");
  const response = await axios({
    method,
    url: repoPath(endpoint, config.repository),
    data,
    headers: githubHeaders(config.actorJid),
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

async function createUpgradePlan(objective, senderName, chatId, actorJid) {
  const request = clean(objective, 1200);
  if (!request) return { success: false, error: "Tell me what you want upgraded." };
  const targetRepository = repositoryFromRequest(request, actorJid);
  if (!targetRepository) return { success: false, error: "Tell me the repository as owner/repo, or choose one first with “ARIA use my GitHub repo owner/repo”. I will not assume another user’s repository." };
  const prompt = `${request}\n\nRepository: ${targetRepository}\nAllowed paths: ${ALLOWED_PATHS.join(", ")}\nForbidden paths: ${DENIED_PATHS.join(", ")}\n\nCreate a bounded plan with at most ${MAX_FILES} files. Include exact relative paths, a summary, tests, risks, and rollback. This is a proposal only; do not write code yet.`;
  try {
    const response = await generateCodingText(prompt, { system: PLAN_PROMPT, maxTokens: 6000, temperature: 0.1 });
    const plan = normalizePlan(extractJson(response), request);
    const proposal = {
      id: `upgrade_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`,
      chatId: clean(chatId, 180),
      createdBy: clean(senderName, 120),
      createdByJid: clean(actorJid, 180),
      state: "proposed",
      repository: targetRepository,
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
  return `🧠 *Upgrade proposal ${proposal.id}*\n\n*Repository:* ${proposal.repository}\n*Base:* ${proposal.baseBranch}\n\n${proposal.summary}\n\n*Files in scope*\n${files}\n\n*Checks:* ${(proposal.tests || []).join(", ")}\n*Risks:* ${(proposal.risks || []).join("; ")}\n*Rollback:* ${proposal.rollback}\n\nNo files have been changed. Say *ARIA approve upgrade ${proposal.id}* to generate a branch and draft GitHub PR.`;
}

async function getRemoteFile(repository, filePath, ref) {
  const data = await githubRequest("GET", `/contents/${filePath.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(ref)}`, undefined, { repository });
  if (Array.isArray(data) || !data?.content) throw new Error(`GitHub did not return file content for ${filePath}.`);
  return Buffer.from(String(data.content).replace(/\n/g, ""), "base64").toString("utf8");
}

async function generateUpgradeFile(repository, file, objective, currentContent, senderName) {
  if (Buffer.byteLength(currentContent, "utf8") > MAX_FILE_BYTES) throw new Error(`${file.path} is too large for a bounded AI edit.`);
  const prompt = `Repository: ${repository}\nFile: ${file.path}\nObjective: ${objective}\nRequested file role: ${file.description}\n\nCurrent file content:\n${currentContent}\n\nReturn the complete updated content for this file. Make the smallest coherent change that fulfills the objective. Preserve unrelated code. Do not add secrets, raw tokens, shell scripts, self-deleting code, or changes outside this file.`;
  const response = await generateCodingText(prompt, { system: CODE_PROMPT, maxTokens: 16000, temperature: 0.12 });
  const content = String(response || "").replace(/^```[\w-]*\s*/i, "").replace(/\s*```$/i, "").trim();
  if (!content || content.length > MAX_FILE_BYTES) throw new Error(`Generated content for ${file.path} was empty or too large.`);
  if (/-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----|ghp_[A-Za-z0-9]+|github_pat_[A-Za-z0-9_]+|VERCEL_TOKEN\s*[:=]/i.test(content)) throw new Error(`Generated content for ${file.path} contained a credential-like value.`);
  return content;
}

async function createGitHubUpgrade(proposalId, senderName, actorJid) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found or expired." };
  if (!["proposed", "ready"].includes(proposal.state)) return { success: false, error: `That upgrade is already ${proposal.state}.` };
  if (proposal.createdByJid && proposal.createdByJid !== actorJid) return { success: false, error: "Only the user who created this proposal can approve it." };
  if (!hasGithubCredential(actorJid || proposal.createdByJid)) return { success: false, error: "GitHub access is not configured for this user. Send a GitHub token privately to ARIA first." };

  try {
    const requestConfig = { repository: proposal.repository, actorJid: actorJid || proposal.createdByJid };
    const ref = await githubRequest("GET", `/git/ref/heads/${encodeURIComponent(proposal.baseBranch)}`, undefined, requestConfig);
    const baseSha = ref?.object?.sha;
    if (!baseSha) throw new Error("The base branch has no readable commit SHA.");
    const commit = await githubRequest("GET", `/git/commits/${baseSha}`, undefined, requestConfig);
    const branch = `aria/${slugify(proposal.objective)}-${Date.now().toString(36)}`;
    const generatedFiles = [];
    for (const file of proposal.files) {
      const current = await getRemoteFile(proposal.repository, file.path, proposal.baseBranch);
      const content = await generateUpgradeFile(proposal.repository, file, proposal.objective, current, senderName);
      generatedFiles.push({ ...file, content, status: "generated" });
    }

    const treeEntries = [];
    for (const file of generatedFiles) {
      const blob = await githubRequest("POST", "/git/blobs", { content: Buffer.from(file.content, "utf8").toString("base64"), encoding: "base64" }, requestConfig);
      treeEntries.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const tree = await githubRequest("POST", "/git/trees", { base_tree: commit.tree.sha, tree: treeEntries }, requestConfig);
    const newCommit = await githubRequest("POST", "/git/commits", {
      message: `aria: ${clean(proposal.objective, 160)}`,
      tree: tree.sha,
      parents: [baseSha],
    }, requestConfig);
    await githubRequest("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha: newCommit.sha }, requestConfig);
    const pr = await githubRequest("POST", "/pulls", {
      title: `aria: ${clean(proposal.objective, 160)}`,
      head: branch,
      base: proposal.baseBranch,
      body: `## ARIA engineering proposal\\n\\n${proposal.summary}\\n\\n### Files\\n${generatedFiles.map((file) => `- ${file.path}: ${file.description}`).join("\\n")}\\n\\n### Required checks\\n${(proposal.tests || []).map((test) => `- ${test}`).join("\\n")}\\n\\n### Safety\\n- Generated in a bounded allowlist.\\n- No direct write to main.\\n- Review and CI are required before merge.\\n- Rollback: ${proposal.rollback}`,
      draft: true,
    }, requestConfig);
    const updated = updateProposal(proposal.id, { state: "pr_open", branch, commitSha: newCommit.sha, prNumber: pr.number, prUrl: pr.html_url, files: generatedFiles });
    return { success: true, proposal: updated, message: `✅ I created a draft GitHub PR without touching main.\n\nPR: ${pr.html_url}\nBranch: ${branch}\nCommit: ${newCommit.sha.slice(0, 12)}\n\nRun the requested checks, then say *ARIA verify upgrade ${proposal.id}*.` };
  } catch (error) {
    updateProposal(proposal.id, { state: "blocked", error: clean(error.message, 500) });
    return { success: false, error: `The upgrade was blocked before completion: ${clean(error.message, 500)}` };
  }
}

async function mergeUpgrade(proposalId, actorJid) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found." };
  if (proposal.createdByJid && proposal.createdByJid !== actorJid) return { success: false, error: "Only the user who created this proposal can merge it." };
  if (proposal.state !== "verified" || proposal.ciState !== "success") return { success: false, error: "This upgrade is not verified green yet. Run verification and wait for successful checks before merging." };
  if (!proposal.prNumber || !proposal.branch) return { success: false, error: "This proposal has no mergeable GitHub pull request." };
  try {
    const requestConfig = { repository: proposal.repository, actorJid: actorJid || proposal.createdByJid };
    const current = await githubRequest("GET", `/pulls/${proposal.prNumber}`, undefined, requestConfig);
    if (current.merged) return { success: false, error: "That pull request is already merged." };
    if (current.base?.ref !== DEFAULT_BRANCH || current.head?.ref !== proposal.branch) return { success: false, error: "The pull request target changed, so I blocked the merge." };
    if (current.draft) await githubRequest("PATCH", `/pulls/${proposal.prNumber}`, { draft: false }, requestConfig);
    const merged = await githubRequest("PUT", `/pulls/${proposal.prNumber}/merge`, { merge_method: "squash", commit_title: `aria: ${clean(proposal.objective, 120)}` }, requestConfig);
    if (!merged.merged) return { success: false, error: clean(merged.message || "GitHub did not merge the pull request.", 400) };
    const updated = updateProposal(proposal.id, { state: "merged", mergedSha: merged.sha || null, mergedAt: Date.now() });
    return { success: true, proposal: updated, message: `✅ Upgrade ${proposal.id} merged into ${DEFAULT_BRANCH}.\n\n${proposal.prUrl || `PR #${proposal.prNumber}`}\nMerge SHA: ${(merged.sha || "unknown").slice(0, 12)}\n\nRender can now deploy the new main revision through its normal connected-repository workflow.` };
  } catch (error) {
    return { success: false, error: `The merge was blocked: ${clean(error.message, 500)}` };
  }
}

async function verifyUpgrade(proposalId, actorJid) {
  const proposal = getProposal(proposalId);
  if (!proposal) return { success: false, error: "Upgrade proposal not found." };
  if (proposal.createdByJid && proposal.createdByJid !== actorJid) return { success: false, error: "Only the user who created this proposal can verify it." };
  if (!proposal.prNumber || !proposal.commitSha) return { success: false, error: "This proposal has no GitHub PR to verify yet." };
  try {
    const requestConfig = { repository: proposal.repository, actorJid: actorJid || proposal.createdByJid };
    const pr = await githubRequest("GET", `/pulls/${proposal.prNumber}`, undefined, requestConfig);
    const status = await githubRequest("GET", `/commits/${proposal.commitSha}/status`, undefined, requestConfig);
    const checks = await githubRequest("GET", `/commits/${proposal.commitSha}/check-runs`, { }, { ...requestConfig, timeout: 20000 });
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
      githubCredentialSource: githubCredentialVault.status().source || (hasGithubCredential() ? "environment" : null),
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

async function listUserRepositories(actorJid) {
  if (!hasGithubCredential(actorJid)) return { success: false, error: "Send your GitHub token privately to ARIA before listing your repositories." };
  const response = await axios({
    method: "GET",
    url: "https://api.github.com/user/repos?per_page=100&sort=updated",
    headers: githubHeaders(actorJid),
    timeout: 20000,
    validateStatus: () => true,
  });
  if (response.status < 200 || response.status >= 300) return { success: false, error: clean(response.data?.message || `GitHub returned HTTP ${response.status}`, 240) };
  const repositories = (Array.isArray(response.data) ? response.data : []).map((repo) => ({ name: repo.full_name, private: Boolean(repo.private), defaultBranch: repo.default_branch || "main" }));
  return { success: true, repositories };
}

async function inspectUserRepository(repository, actorJid) {
  const target = repository || githubCredentialVault.getWorkspaceForUser(actorJid);
  if (!target) {
    const listed = await listUserRepositories(actorJid);
    if (!listed.success) return listed;
    const lines = listed.repositories.map((repo) => `• ${repo.name}${repo.private ? " 🔒" : ""}`).join("\n") || "No repositories were returned for this GitHub account.";
    return { success: true, message: `📚 I found your GitHub repositories, but you have not selected an active workspace yet.\n\n${lines}\n\nTell me “ARIA use my GitHub repo owner/repo” and I’ll inspect that repository.` };
  }
  try {
    const repo = await githubRequest("GET", "", undefined, { repository: target, actorJid });
    return {
      success: true,
      repository: target,
      message: `🔎 *Repository check*\n\n*${repo.full_name || target}*${repo.private ? " 🔒" : ""}\n${repo.description || "No description provided."}\n\n• Default branch: *${repo.default_branch || "main"}*\n• Open issues: *${Number(repo.open_issues_count || 0)}*\n• Last updated: *${repo.updated_at || "unknown"}*\n\nTell me what you want changed, reviewed, or tested and I’ll use this repository.`
    };
  } catch (error) {
    return { success: false, error: `I could not check ${target} with your GitHub credential: ${clean(error.message, 300)}` };
  }
}

async function selectUserRepository(repository, actorJid) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || "")) return { success: false, error: "Use the repository in owner/repo format." };
  try {
    const repo = await githubRequest("GET", "", undefined, { repository, actorJid });
    const saved = githubCredentialVault.setWorkspaceForUser(actorJid, repository);
    if (!saved.success) return saved;
    return { success: true, repository, message: `✅ Your active ARIA workspace is now *${repo.full_name || repository}*. Future engineering requests from you will use this repository until you choose another.` };
  } catch (error) {
    return { success: false, error: `I could not access ${repository} with your GitHub credential: ${clean(error.message, 300)}` };
  }
}

async function handleEngineeringRequest(rawInput, senderName, chatId, actorJid) {
  const raw = clean(rawInput, 1400);
  const lower = raw.toLowerCase();
  if (!raw || (/^(?:status|inspect|inventory|modules|capabilities|what can you do|what modules)/i.test(raw) && !/\b(?:repo|repository|github|codebase|dashboard)\b/i.test(raw))) return { success: true, message: formatInspection(inspectSystem()), report: inspectSystem() };
  const id = raw.match(/\b(upgrade_[a-z0-9_]+)\b/i)?.[1];
  if (/^(?:list|show|check)\s+(?:my\s+)?(?:github\s+)?repos(?:itories)?\b/i.test(raw)) {
    const result = await listUserRepositories(actorJid);
    if (!result.success) return result;
    const lines = result.repositories.map((repo) => `• ${repo.name}${repo.private ? " 🔒" : ""}`).join("\n") || "No repositories were returned for this GitHub account.";
    return { success: true, message: `📚 *Your GitHub repositories*\n\n${lines}\n\nSay “ARIA use my GitHub repo owner/repo” to select one.` };
  }
  if (/^(?:check|inspect|look\s+at|show\s+me)\s+(?:my\s+)?(?:github\s+)?repo(?:sitory)?\b/i.test(raw) && !/\brepo(?:sitories)?\b\s*$/i.test(raw)) {
    const explicit = raw.match(/\b([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)\b/)?.[1];
    return inspectUserRepository(explicit, actorJid);
  }
  if (/^(?:check|inspect|look\s+at|show\s+me)\s+(?:my\s+)?(?:github\s+)?repo(?:sitory)?$/i.test(raw)) return inspectUserRepository(null, actorJid);
  const workspaceRequest = raw.match(/^(?:use|select|switch(?:\s+to)?)\s+(?:my\s+)?(?:github\s+)?(?:repo(?:sitory)?\s+)?([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/i);
  if (workspaceRequest) return selectUserRepository(workspaceRequest[1], actorJid);
  if (/^(?:clear|forget|remove)\s+(?:my\s+)?(?:active\s+)?(?:github\s+)?workspace$/i.test(raw)) {
    githubCredentialVault.clearWorkspaceForUser(actorJid);
    return { success: true, message: "✅ Your active GitHub workspace has been cleared. Name a repository explicitly for your next task." };
  }
  if (/^(?:list|show)\s+(?:upgrades|proposals|engineering)/i.test(raw)) return { success: true, message: `🧾 *Recent engineering proposals*\n\n${listProposals()}` };
  if (/^merge\b/i.test(raw) && id) return mergeUpgrade(id, actorJid);
  if (/^(?:approve|apply|execute)\b/i.test(raw)) return createGitHubUpgrade(id || raw.split(/\s+/)[1], senderName, actorJid);
  if (/^(?:verify|check|test)\b/i.test(raw) && id) return verifyUpgrade(id, actorJid);
  const objective = raw.replace(/^(?:plan|propose|implement|upgrade|improve|build|add|change|fix)\s*/i, "").trim() || raw;
  return createUpgradePlan(objective, senderName, chatId, actorJid);
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
    _test: { safeRelativePath, normalizePlan, slugify, repositoryName, repositoryFromRequest },
};
