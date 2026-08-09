// ── ARIA Scenario Simulator (lightweight) ─────────────────────
// Before ARIA commits to a risky/autonomous action, it runs a dry-run and
// returns an expected outcome + risk verdict. This is the "digital twin"
// idea shrunk to something real and shippable on the bot: a deterministic
// risk evaluator over proposed actions, plus a sandbox "dry-run" for commands
// that ARIA would otherwise execute for real.
//
// It's not a full world-simulator (that needs real infra), but it IS a real
// safety layer: it flags destructive / irreversible / high-cost / network /
// identity actions and recommends approval before execution.

const { error } = require("../utils/logger");

// Risk rules: keyword -> { weight, flag, advice }
const RISK_RULES = [
  { weight: 10, flag: "destructive", pattern: /\b(delete|remove|drop|wipe|truncate|rm\s*-rf|unlink|destroy)\b/i, advice: "This deletes/removes something permanent." },
  { weight: 9,  flag: "irreversible", pattern: /\b(overwrite|reset|clear|purge|format)\b/i, advice: "This is hard or impossible to undo." },
  { weight: 8,  flag: "high-cost", pattern: /\$(?:\d[\d,]*|\d+(?:k|m))\b|(buy|purchase|pay|paypal|transfer|send money|checkout)/i, advice: "This involves money or a purchase." },
  { weight: 7,  flag: "network", pattern: /\b(curl|wget|download|fetch|request|post to|deploy|push|commit -a|npm publish)\b/i, advice: "This makes a network/deploy side effect." },
  { weight: 6,  flag: "identity", pattern: /\b(login|password|token|secret|api[_-]?key|credential|auth)\b/i, advice: "This touches credentials/identity." },
  { weight: 4,  flag: "irreversible-ish", pattern: /\b(rename|move|replace|edit|modify|update)\b/i, advice: "This modifies existing state." },
];

// Evaluate a proposed action string. Returns { score, risk: 'high'|'medium'|'low', flags, advice }.
function evaluateAction(actionText) {
  const text = String(actionText || "");
  if (!text.trim()) return { score: 0, risk: "low", flags: [], advice: "Nothing to evaluate." };

  let score = 0;
  const flags = [];
  const advice = [];
  for (const rule of RISK_RULES) {
    if (rule.pattern.test(text)) {
      score += rule.weight;
      flags.push(rule.flag);
      advice.push(rule.advice);
    }
  }

  const risk = score >= 18 ? "high" : score >= 10 ? "medium" : "low";
  return {
    score,
    risk,
    flags,
    advice: advice.slice(0, 3),
    verdict: risk === "high"
      ? "⚠️ HIGH RISK — require explicit human approval before running."
      : risk === "medium"
        ? "🟡 MEDIUM RISK — recommend a dry-run / double-check."
        : "🟢 LOW RISK — safe to proceed.",
  };
}

// Rehearse a command: present what would happen without actually doing it.
// Returns a readable dry-run preview.
async function rehearse(commandText, plan) {
  const ev = evaluateAction(commandText + " " + (plan || ""));
  const lines = [];
  lines.push(`🧪 *Scenario Rehearsal*`);
  lines.push(`Action: "${String(commandText).slice(0, 80)}"`);
  lines.push(`Risk: *${ev.risk.toUpperCase()}* (score ${ev.score})`);
  if (ev.flags.length) lines.push(`Flags: ${ev.flags.join(", ")}`);
  if (ev.advice.length) lines.push(`Why: ${ev.advice.join(" ")}`);
  lines.push(`Verdict: ${ev.verdict}`);
  if (ev.risk !== "low") lines.push(`\n_Suggest: run *!sim approve <id>* only if you're sure, or rephrase to reduce risk._`);
  return lines.join("\n");
}

// Simulate a mission plan: dry-run each step and report expected outcome/risk.
function simulatePlan(plan) {
  if (!Array.isArray(plan) || !plan.length) return "No plan steps to simulate.";
  const lines = [`🧪 *Plan Simulation (dry-run)*\n`];
  let total = 0;
  for (const step of plan) {
    const text = typeof step === "string" ? step : (step.type + " " + (step.arg || "")).trim();
    const ev = evaluateAction(text);
    total += ev.score;
    const icon = ev.risk === "high" ? "🔴" : ev.risk === "medium" ? "🟡" : "🟢";
    lines.push(`${icon} ${text.slice(0, 70)} — ${ev.risk} (${ev.score})`);
  }
  lines.push(`\n*Overall risk score:* ${total}`);
  lines.push(total >= 18 ? "⚠️ Plan has high-risk steps — approval recommended." : "Plan looks reasonable to proceed.");
  return lines.join("\n");
}

module.exports = { evaluateAction, rehearse, simulatePlan };
