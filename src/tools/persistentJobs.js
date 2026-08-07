// ── Persistent AI Jobs ────────────────────────────────────
// ARIA works on tasks in the background and reports progress
// !job create <task> — start a persistent job
// !job status <id> — check progress
// !jobs — list all jobs

const { getAIResponse } = require("./ai");
const { searchWeb } = require("./webSearch");
const { scrapeUrl } = require("./scraper");
const fs = require("fs");
const path = require("path");
const { v4: uuidv4 } = require("uuid");

const FILE = path.join(__dirname, "../../data/jobs.json");
let jobs = {};
try { if (fs.existsSync(FILE)) jobs = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) { jobs = {}; }
function save() { try { fs.writeFileSync(FILE, JSON.stringify(jobs, null, 2)); } catch (e) {} }

let sockRef = null;
function setSock(s) { sockRef = s; }

function createJob(chatId, creator, task) {
  const id = uuidv4().slice(0, 8);
  jobs[id] = {
    id, chatId, creator, task,
    status: "running",
    progress: "Starting...",
    steps: [],
    currentStep: 0,
    totalSteps: 0,
    result: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  save();
  return id;
}

async function executeJob(id) {
  const job = jobs[id];
  if (!job) return;

  try {
    await runJobSteps(job);
  } catch (err) {
    // Never leave a job stuck in "running" — mark it failed so the user gets
    // an answer instead of a silent hang.
    job.status = "failed";
    job.result = "Job failed: " + (err?.message || "unknown error");
    job.progress = "Failed";
    job.updatedAt = Date.now();
    save();
    if (sockRef) {
      try {
        await sockRef.sendMessage(job.chatId, {
          text: "❌ *Job Failed: " + job.task.slice(0, 50) + "...*\n\n" + job.result
        });
      } catch (_) {}
    }
  }
}

async function runJobSteps(job) {
  // Plan the work
  const plan = await getAIResponse(
    `Break this task into max 6 concrete steps: "${job.task}"
    Steps can be: SEARCH, CODE, WRITE, ANALYZE, THINK, DONE
    Output numbered steps only.`,
    "ARIA_JOB", [], null, "You are a task planner. Output ONLY numbered steps."
  );

  const steps = plan.split("\n")
    .map(l => l.trim())
    .filter(l => /^\d+\.\s*(SEARCH|CODE|WRITE|ANALYZE|THINK|DONE)/i.test(l));

  job.totalSteps = steps.length;
  job.steps = steps;
  job.progress = "Planned " + steps.length + " steps";
  save();

  let context = "";

  for (let i = 0; i < steps.length; i++) {
    if (job.status !== "running") break;
    job.currentStep = i + 1;
    const step = steps[i];
    const upper = step.toUpperCase();

    job.progress = "Step " + (i + 1) + "/" + steps.length + ": " + step;
    save();

    if (upper.includes("SEARCH(")) {
      const q = step.match(/SEARCH\(([^)]+)\)/i)?.[1];
      if (q) {
        const result = await searchWeb(q);
        context += "\n[SEARCH: " + q + "]\n" + result;
      }
    }

    if (upper.includes("SCRAPE(")) {
      const url = step.match(/SCRAPE\(([^)]+)\)/i)?.[1];
      if (url) {
        const result = await scrapeUrl(url);
        context += "\n[SCRAPED: " + url + "]\n" + (result?.slice(0, 1000) || "");
      }
    }

    if (upper.includes("DONE") || upper.includes("THINK")) {
      // Final step - synthesize
    }
  }

  // Generate final result
  const finalPrompt = `Task: ${job.task}\n\nInformation gathered:\n${context.slice(0, 4000)}\n\nProvide a complete answer.`;
  const result = await getAIResponse(finalPrompt, "ARIA_JOB", []);

  job.status = "completed";
  job.result = result;
  job.progress = "Completed";
  job.updatedAt = Date.now();
  save();

  // Notify if we have the socket
  if (sockRef) {
    try {
      await sockRef.sendMessage(job.chatId, {
        text: "✅ *Job Complete: " + job.task.slice(0, 50) + "...*\n\n" + result.slice(0, 1500) + "\n\n_Full result: !job view " + job.id + "_"
      });
    } catch (e) {}
  }
}

function getJobs(chatId) {
  return Object.values(jobs).filter(j => j.chatId === chatId);
}

function getJob(id) {
  return jobs[id] || null;
}

function cancelJob(id) {
  if (jobs[id]) {
    jobs[id].status = "cancelled";
    save();
    return true;
  }
  return false;
}

function formatJobList(list) {
  if (list.length === 0) return "No jobs. Create one with *!job create <task>*";
  return list.map(j => {
    const icon = j.status === "completed" ? "✅" : j.status === "cancelled" ? "⛔" : "🔄";
    return icon + " *" + j.id + "* — " + j.task.slice(0, 60) + "\n   Status: " + j.status + " | " + j.progress;
  }).join("\n\n");
}

module.exports = { createJob, executeJob, getJobs, getJob, cancelJob, formatJobList, setSock };
