// ── ARIA Academy — Company Simulator (flagship capstone) ────────
// The learner runs a simulated software company. The catch that ties the
// WHOLE academy together: your company's capability = your DEMONSTRATED
// engineering skill. Strong backend DNA? You'll ace backend projects. Weak
// frontend? Frontend projects are a gamble until you hire a frontend
// engineer (or go learn it in the academy, which makes you personally better).
//
// Loop per turn (week):
//   1. Active projects make progress based on your skill capacity + engineers
//   2. Engineers cost weekly salary
//   3. Completed projects ship → revenue + reputation, small chance of a bug
//   4. Random incidents can hit → resolve using your skills or lose reputation/cash
//   5. Revenue comes in, cash flows out, you grow
//
// Win condition: grow a 1-engineer startup into a company with a real
// portfolio, shipped products, and a reputation you actually earned.

const fs = require("fs");
const path = require("path");
const { addXp, recordAttempt, skillConfidence } = require("./learnerModel");
const { levelUpText } = require("./xpSystem");
const { clusterConfidence, engineeringDNA, CAREERS } = require("./engineeringDNA");
const { CLUSTERS } = require("./engineeringDNA");

const STATE_FILE = path.join(__dirname, "../../../data/companyState.json");
let state = { companies: {}, lastId: 0 };
function load() { try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) || { companies: {}, lastId: 0 }; } catch (_) { state = { companies: {}, lastId: 0 }; } }
function save() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch (_) {} }
load();
function nid(prefix) { state.lastId += 1; return prefix + state.lastId; }

// ── Track definitions (mirror DNA clusters) ─────────────────────
// Single-cluster tracks: { cluster }. Composite tracks use a UNIFORM
// `clusters: [[name, weight], ...]` array so every system (backlog weighting,
// capacity, incident difficulty) agrees on the same definition.
const TRACKS = {
  "frontend":  { label: "Frontend", emoji: "🎨", cluster: "Frontend / React" },
  "backend":   { label: "Backend", emoji: "⚙️", cluster: "Backend / Node" },
  "fullstack": { label: "Full-Stack", emoji: "🦾", clusters: [["Frontend / React", 0.5], ["Backend / Node", 0.5]] },
  "devops":    { label: "DevOps", emoji: "☁️", cluster: "DevOps / Cloud" },
  "data":      { label: "Data", emoji: "📊", cluster: "Databases" },
};

// Resolve a track to a list of [clusterName, weight] (uniform across systems).
function trackClusters(track) {
  const t = TRACKS[track];
  if (!t) return [];
  if (Array.isArray(t.clusters)) return t.clusters;
  return [[t.cluster, 1]];
}

// Weighted learner confidence (0-100) in a track across its cluster(s).
// Composite tracks (e.g. fullstack) blend their clusters by weight, so the
// SAME definition drives backlog generation, capacity, and incidents.
function trackConfidence(uid, track) {
  const cls = trackClusters(track);
  if (!cls.length) return 0;
  let num = 0, den = 0;
  for (const [name, w] of cls) {
    num += clusterConfidence(uid, name).score * w;
    den += w;
  }
  return den ? num / den : 0;
}

// Engineer roles we can hire (fill skill gaps the learner lacks).
const HIRABLES = [
  { role: "frontend", label: "Frontend dev", emoji: "🎨", salary: 4500, upfront: 18000 },
  { role: "backend",  label: "Backend dev", emoji: "⚙️", salary: 4500, upfront: 18000 },
  { role: "devops",   label: "DevOps eng",  emoji: "☁️", salary: 5000, upfront: 20000 },
  { role: "data",     label: "Data eng",    emoji: "📊", salary: 5000, upfront: 20000 },
  { role: "fullstack",label: "Full-stack dev", emoji: "🦾", salary: 6000, upfront: 24000 },
];

const PROJECT_TEMPLATES = {
  // frontend defined once below (single authoritative source, no dup)
  backend: [
    { name: "REST API for a mobile app", value: 22000, rep: 4, complexity: 1.4 },
    { name: "Payment webhook service", value: 42000, rep: 8, complexity: 2.5 },
    { name: "Real-time notifications service", value: 60000, rep: 11, complexity: 3.4 },
  ],
  fullstack: [
    { name: "E-commerce storefront", value: 48000, rep: 8, complexity: 2.8 },
    { name: "SaaS onboarding platform", value: 75000, rep: 12, complexity: 3.6 },
    { name: "Real-estate listing platform", value: 60000, rep: 10, complexity: 3.1 },
    { name: "Team collaboration tool MVP", value: 68000, rep: 11, complexity: 3.4 },
  ],
  devops: [
    { name: "CI/CD pipeline setup", value: 20000, rep: 4, complexity: 1.6 },
    { name: "Kubernetes migration", value: 55000, rep: 10, complexity: 3.0 },
    { name: "Observability stack (logs + traces + metrics)", value: 42000, rep: 8, complexity: 2.4 },
    { name: "Multi-region failover setup", value: 62000, rep: 12, complexity: 3.5 },
  ],
  data: [
    { name: "Reporting & analytics dashboard", value: 30000, rep: 6, complexity: 2.0 },
    { name: "ETL data warehouse", value: 65000, rep: 11, complexity: 3.2 },
    { name: "Real-time fraud detection pipeline", value: 72000, rep: 13, complexity: 3.7 },
  ],
  frontend: [
    { name: "Marketing landing page", value: 18000, rep: 3, complexity: 1.2 },
    { name: "Customer dashboard UI", value: 35000, rep: 6, complexity: 2.2 },
    { name: "Design system + component lib", value: 50000, rep: 9, complexity: 3.2 },
    { name: "Accessibility audit + fix", value: 26000, rep: 7, complexity: 1.8 },
    { name: "Progressive web app conversion", value: 46000, rep: 9, complexity: 2.6 },
  ],
};

const INCIDENTS = [
  { id: "db-pool", title: "DB connection pool exhausted", track: "backend", fix: "index, limit query, cap pool", tokens: ["index", "limit", "pool"] },
  { id: "memory-leak", title: "Slow memory leak after deploy", track: "backend", fix: "bounded LRU cache / TTL / external cache", tokens: ["lru", "cache", "ttl"] },
  { id: "frontend-crash", title: "Dashboard crashes in Safari", track: "frontend", fix: "fix the CSS/JS browser bug, add polyfill, test in Safari", tokens: ["polyfill", "safari", "browser"] },
  { id: "deploy-outage", title: "Deploy took the site down", track: "devops", fix: "roll back the release, fix the broken deploy pipeline", tokens: ["roll", "back", "rollback", "pipeline"] },
  { id: "slow-report", title: "Analytics report is extremely slow", track: "data", fix: "add index, optimize the query, cache results", tokens: ["index", "query", "cache"] },
  { id: "ssrf-proxy", title: "Image proxy lets attackers reach internal services", track: "backend", fix: "allowlist public hosts, block private/link-local IP ranges", tokens: ["allowlist", "block", "private", "ip", "range"] },
  { id: "race-balance", title: "Race condition lets users double-spend", track: "backend", fix: "atomic conditional update / transaction with row lock / optimistic version check", tokens: ["atomic", "transaction", "lock", "version"] },
  { id: "stale-cache", title: "Stale cache serving old prices/stock", track: "data", fix: "invalidate cache on write (write-through or explicit purge), short TTL", tokens: ["invalidate", "purge", "ttl", "write-through"] },
  { id: "mobile-checkout", title: "Checkout button unresponsive on mobile", track: "frontend", fix: "fix the overlay z-index/pointer-events so it doesn't cover the button", tokens: ["z-index", "pointer-events", "overlay"] },
  { id: "auth-bypass", title: "Rate-limit auth endpoint bypass", track: "devops", fix: "enforce rate limiting per-user/IP, add lockout + alerting", tokens: ["rate", "limit", "lockout", "alert"] },
];

// ── Company creation ────────────────────────────────────────────
function foundCompany(uid, name) {
  if (state.companies[uid]) return { ok: false, text: "You already run *" + state.companies[uid].name + "*. Use `!company` for status or `!company abandon` to start over." };
  const company = {
    name: name || "My Startup",
    founder: uid,
    foundedAt: Date.now(),
    turn: 0,
    cash: 100000,
    reputation: 50,
    engineers: [],            // { id, role, label }
    projects: [],             // { id, track, ...complexity, progress, status }
    backlog: [],              // generated projects not yet taken
    shipped: [],              // { name, track, value }
    incidents: [],            // active incidents { id, title, track, tokens }
    resolvedIncidents: 0,
  };
  company.backlog = generateBacklog(uid);
  state.companies[uid] = company;
  save();
  return { ok: true, text: intro(company, uid) };
}

// Backlog is weighted toward the learner's strongest tracks (they're a real
// engineer there), with a couple of stretch tracks.
function generateBacklog(uid) {
  const scored = Object.keys(TRACKS).map((k) => ({ key: k, conf: trackConfidence(uid, k) })).sort((a, b) => b.conf - a.conf);
  const pool = [];
  // Strongest two tracks get most projects.
  const strong = scored.slice(0, 2).map((s) => s.key);
  const stretch = scored.slice(2).map((s) => s.key);
  for (const key of strong) for (const p of PROJECT_TEMPLATES[key]) pool.push({ ...p, track: key });
  for (const key of stretch) for (const p of PROJECT_TEMPLATES[key].slice(0, 1)) pool.push({ ...p, track: key });
  return pool.map((p) => ({ id: nid("proj-"), ...p, progress: 0, status: "available" }));
}

function intro(c, uid) {
  const dna = engineeringDNA(uid);
  const top = dna[0]?.cluster || "none";
  return `🏢 *${c.name}* founded!\n\nYou start with:\n💵 $100k · 🤝 Reputation 50 · 👤 1 founder (you)\n\nYour strongest area: *${top}* (${dna[0]?.score}%). Your company is best at what YOU are best at.\n\nUse these commands:\n• \`!company\` — status\n• \`!company project\` — take a project from the backlog\n• \`!company hire\` — hire an engineer (fills skill gaps)\n• \`!company advance\` — advance a week\n• \`!company incident\` — handle a current incident\n• \`!company help\` — all commands\n\nYour backlog is weighted to your strengths. Go take your first project.`;
}

// ── Capacity & progress ─────────────────────────────────────────
// Your personal capacity in a track = your cluster confidence (0..1) scaled.
// Engineers add capacity. Incidents stall progress.
function capacityFor(c, track) {
  let cap = 0;
  // Learner's personal skill capacity — uniform multi-cluster confidence.
  cap += trackConfidence(c.founder, track) / 100; // 0..1
  // Engineers add capacity in their track (fullstack covers all tracks).
  for (const e of c.engineers) if (e.role === track || e.role === "fullstack") cap += 0.7;
  return cap;
}

// ── Turn advance ────────────────────────────────────────────────
function advance(uid) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "You don't run a company yet. `!company start <name>`" };
  c.turn += 1;
  const log = [`📅 *Week ${c.turn}*`];

  // Active incidents stall everything.
  if (c.incidents.length) {
    log.push(`🚨 ${c.incidents.length} incident(s) in progress — all projects paused until you fix them. Use \`!company incident\`.`);
  }

  // Project progress
  for (const p of c.projects.filter((x) => x.status === "active")) {
    const cap = capacityFor(c, p.track);
    const prog = cap / p.complexity;
    p.progress += prog;
    if (p.progress >= 1) {
      p.status = "done";
      c.cash += p.value;
      c.reputation += p.rep;
      c.shipped.push({ name: p.name, track: p.track, value: p.value, turn: c.turn });
      log.push(`✅ *Shipped:* ${p.name} (+$${p.value.toLocaleString()}, +${p.rep} rep)`);
    }
  }

  // Salaries
  const salary = c.engineers.reduce((a, e) => a + e.salary, 0);
  c.cash -= salary;
  if (salary) log.push(`💸 Engineer salaries: -$${salary.toLocaleString()}`);

  // New random incident (~18% if none active, more likely as rep grows)
  if (!c.incidents.length && Math.random() < 0.18) {
    const inc = INCIDENTS[Math.floor(Math.random() * INCIDENTS.length)];
    c.incidents.push({ ...inc });
    log.push(`🚨 *INCIDENT:* ${inc.title} — projects will stall until you resolve it. Use \`!company incident\`.`);
  }

  // Cashflow safety
  if (c.cash < 0) {
    c.cash = Math.max(0, c.cash);
    c.reputation = Math.max(0, c.reputation - 5);
    log.push(`⚠️ Overdraft — burned ${TRACKS[c.engineers[0]?.role]?.label || ""} runway. Reputation -5.`);
  }

  save();
  log.push(statusLine(c));
  return { ok: true, text: log.join("\n") };
}

// ── Projects ────────────────────────────────────────────────────
function projectView(uid) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  const avail = c.backlog.filter((p) => p.status === "available");
  const active = c.projects.filter((p) => p.status === "active");
  const lines = [`📋 *Backlog* (${avail.length} available)`];
  if (!avail.length) lines.push("No projects available. Advance a week to refresh.");
  avail.forEach((p, i) => {
    const t = TRACKS[p.track];
    const cap = capacityFor(c, p.track);
    const risk = cap >= 0.8 ? "low" : cap >= 0.5 ? "med" : "high";
    lines.push(`${i + 1}. ${t.emoji} *${p.name}* — $${p.value.toLocaleString()} · complexity ${p.complexity} · your capacity ${(cap * 100).toFixed(0)}% (${risk} risk)`);
  });
  if (active.length) {
    lines.push(`\n*In progress:*`);
    for (const p of active) lines.push(`• ${p.name} — ${(p.progress * 100).toFixed(0)}%`);
  }
  lines.push(`\nTake one: \`!company project <number>\``);
  return { ok: true, text: lines.join("\n") };
}

function takeProject(uid, idx) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  const avail = c.backlog.filter((p) => p.status === "available");
  const n = Number(idx) - 1;
  const p = avail[n];
  if (!p) return { ok: false, text: "Pick a valid number from the backlog. `!company project`" };
  if (c.incidents.length) return { ok: false, text: "You have active incidents. Resolve them before starting new work." };
  p.status = "active";
  c.projects.push(p);
  save();
  return { ok: true, text: `▶️ Started *${p.name}* (${TRACKS[p.track].emoji} ${TRACKS[p.track].label}). It'll make progress each week based on your skill + engineers.` };
}

// ── Hiring ──────────────────────────────────────────────────────
function hireView(uid) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  const lines = [`👥 *Hire an engineer* (cash: $${c.cash.toLocaleString()})`];
  HIRABLES.forEach((h, i) => {
    const have = c.engineers.filter((e) => e.role === h.role).length;
    lines.push(`${i + 1}. ${h.emoji} ${h.label} — $${h.upfront.toLocaleString()} upfront + $${h.salary.toLocaleString()}/wk${have ? ` (have ${have})` : ""}`);
  });
  lines.push(`\nEngineers add 0.7 capacity in their track every week — invaluable in tracks YOU are weak in.`);
  lines.push(`\nHire: \`!company hire <number>\``);
  return { ok: true, text: lines.join("\n") };
}

function hireEngineer(uid, idx) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  const n = Number(idx) - 1;
  const h = HIRABLES[n];
  if (!h) return { ok: false, text: "Pick a valid number. `!company hire`" };
  if (c.cash < h.upfront) return { ok: false, text: `Not enough cash. Need $${h.upfront.toLocaleString()}, you have $${c.cash.toLocaleString()}.` };
  c.cash -= h.upfront;
  c.engineers.push({ id: nid("eng-"), role: h.role, label: h.label });
  save();
  return { ok: true, text: `🤝 Hired a ${h.emoji} ${h.label} for $${h.upfront.toLocaleString()}. They add ${TRACKS[h.role].emoji} ${TRACKS[h.role].label} capacity every week.` };
}

// ── Incidents (company-scoped) ──────────────────────────────────
function incidentView(uid) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  if (!c.incidents.length) return { ok: true, text: "No active incidents. The systems are calm... for now. 😐" };
  const lines = [`🚨 *Active incidents:*`];
  for (const inc of c.incidents) {
    lines.push(`• ${inc.title} (${TRACKS[inc.track]?.emoji} ${TRACKS[inc.track]?.label || inc.track})`);
    lines.push(`  Fix it: \`!company incident <number> <your fix>\``);
  }
  lines.push(`\nThe fix is graded against your engineering knowledge — your skill in that track raises your odds.`);
  return { ok: true, text: lines.join("\n") };
}

function resolveIncident(uid, idx, fix) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company. `!company start <name>`" };
  const n = Number(idx) - 1;
  const inc = c.incidents[n];
  if (!inc) return { ok: false, text: "Pick a valid incident number. `!company incident`" };
  const a = String(fix || "").toLowerCase();
  const tokens = inc.tokens.filter((t) => a.includes(t));
  // Skill in this track boosts the chance of recognizing the right fix.
  const conf = trackConfidence(c.founder, inc.track); // 0..100
  const skillBoost = conf / 100; // 0..1
  const recognized = tokens.length >= 1 || (skillBoost >= 0.5 && tokens.length >= 1);
  if (!recognized) {
    c.reputation = Math.max(0, c.reputation - 3);
    save();
    return { ok: true, text: `❌ That fix missed. You lost 3 reputation. Correct fix was: ${inc.fix}. Reputation now ${c.reputation}. Try again or hire/learn for this area.` };
  }
  // Resolve: remove incident, rep + , small XP.
  c.incidents = c.incidents.filter((x) => x !== inc);
  c.resolvedIncidents += 1;
  c.reputation += 4;
  recordAttempt(uid, { track: "company", level: "incident", lessonId: inc.id, sectionType: "incident", correct: true, skill: inc.track });
  const up = addXp(uid, 25, "Company incident");
  save();
  return { ok: true, text: `✅ Incident resolved: *${inc.title}*. +4 reputation (now ${c.reputation}), +25 XP${levelUpText(up)}. Projects can resume.` };
}

// ── Status ──────────────────────────────────────────────────────
function statusLine(c) {
  const active = c.projects.filter((p) => p.status === "active").length;
  const shippedVal = c.shipped.reduce((a, s) => a + s.value, 0);
  const eng = c.engineers.length;
  const health = c.cash > 50000 && c.reputation > 60 ? "📈" : c.cash > 0 ? "🟡" : "🔴";
  return `\n💵 $${c.cash.toLocaleString()} · 🤝 Rep ${c.reputation} · 👥 ${eng} eng · 📦 ${c.shipped.length} shipped ($${shippedVal.toLocaleString()}) · 📋 ${active} in progress · ${health}`;
}

function statusView(uid) {
  const c = state.companies[uid];
  if (!c) return { ok: false, text: "No company yet. `!company start <name>`" };
  const lines = [`🏢 *${c.name}* — Week ${c.turn}`];
  lines.push(statusLine(c));
  if (c.engineers.length) lines.push(`\n*Team:* ${c.engineers.map((e) => `${TRACKS[e.role].emoji} ${e.label}`).join(" · ")}`);
  if (c.incidents.length) lines.push(`\n🚨 *Active incidents:* ${c.incidents.map((i) => i.title).join("; ")} — use \`!company incident\``);
  const active = c.projects.filter((p) => p.status === "active");
  if (active.length) lines.push(`\n*In progress:*\n${active.map((p) => `• ${p.name} ${(p.progress * 100).toFixed(0)}%`).join("\n")}`);
  if (c.shipped.length) {
    lines.push(`\n*Shipped:*\n${c.shipped.slice(-4).map((s) => `• ${s.name} ($${s.value.toLocaleString()})`).join("\n")}`);
  }
  lines.push(`\nCommands: \`!company project\` \`!company hire\` \`!company advance\` \`!company incident\` \`!company help\``);
  return { ok: true, text: lines.join("\n") };
}

// ── Command dispatcher ──────────────────────────────────────────
function help() {
  return `🏢 *Company Simulator* — run a software company built on YOUR real skills.\n\nCommands:\n• \`!company start <name>\` — found your company\n• \`!company\` — status\n• \`!company project\` — view/take a project\n• \`!company project <n>\` — take project #n\n• \`!company hire\` — view engineers\n• \`!company hire <n>\` — hire engineer #n\n• \`!company advance\` — advance a week\n• \`!company incident\` — view active incidents\n• \`!company incident <n> <fix>\` — resolve incident #n\n• \`!company abandon\` — shut down and restart`;
}

async function handleCompanyCommand(sock, msg, args, ctx) {
  const { reply } = require("../../utils/baileysHelpers");
  const uid = (ctx.senderJid || "").split("@")[0];
  const argv = (Array.isArray(args) ? args : []).map((a) => String(a).trim()).filter(Boolean);
  const sub = (argv[0] || "").toLowerCase();
  const rest = argv.slice(1);

  let r;
  switch (sub) {
    case "start": case "found": r = foundCompany(uid, rest.join(" ") || null); break;
    case "project": case "projects":
      r = rest.length ? takeProject(uid, rest[0]) : projectView(uid);
      break;
    case "hire": case "hiring":
      r = rest.length ? hireEngineer(uid, rest[0]) : hireView(uid);
      break;
    case "advance": case "week": case "next": r = advance(uid); break;
    case "incident": case "incidents":
      r = rest.length ? resolveIncident(uid, rest[0], rest.slice(1).join(" ")) : incidentView(uid);
      break;
    case "abandon": case "reset": case "shutdown":
      delete state.companies[uid]; save();
      r = { ok: true, text: "Company shut down. You can `!company start <name>` fresh." };
      break;
    case "help": case "commands": case "?": r = { ok: true, text: help() }; break;
    default: r = rest.length ? foundCompany(uid, argv.join(" ")) : statusView(uid);
  }
  return reply(sock, msg, r.text);
}

module.exports = { foundCompany, advance, projectView, takeProject, hireView, hireEngineer, incidentView, resolveIncident, statusView, handleCompanyCommand, TRACKS, HIRABLES, INCIDENTS };
