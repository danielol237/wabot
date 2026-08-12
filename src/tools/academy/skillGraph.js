// ── ARIA Academy — Skill Graph ────────────────────────────────────
// A dependency graph of skills. Lets the adaptive tutor do prerequisite
// diagnosis: if a learner struggles with skill X, find which prerequisite
// they're actually missing and drill THAT instead of re-teaching X.
//
// Skills are nodes; an edge A → B means "A is a prerequisite of B".
// Diagnosis: walk the graph from a weak skill toward its root prerequisites,
// using the learner model's confidence per skill to find the weakest ancestor.

// Skill dependency graph (prerequisite → depends-on-it).
// Format: { skill: [prerequisites...] }
const SKILL_GRAPH = {
  "js-basics": [],
  "variables": ["js-basics"],
  "functions": ["variables"],
  "scope": ["functions"],
  "closures": ["functions", "scope"],
  "callbacks": ["functions"],
  "promises": ["callbacks", "closures"],
  "async-await": ["promises"],
  "error-handling": ["async-await", "try-catch-basics"],
  "try-catch-basics": ["functions"],
  "concurrency": ["async-await", "event-loop"],
  "event-loop": ["callbacks"],
  "http": ["networking-basics", "js-basics"],
  "rest-apis": ["http", "json"],
  "json": ["js-basics"],
  "auth": ["rest-apis", "hashing"],
  "hashing": ["js-basics"],
  "sql-select": ["sql-basics"],
  "sql-basics": [],
  "sql-joins": ["sql-select"],
  "sql-group": ["sql-select"],
  "sql-index": ["sql-select"],
  "sql-transactions": ["sql-basics"],
  "docker-basics": ["linux-basics"],
  "linux-basics": [],
  "containers": ["docker-basics"],
  "kubernetes": ["containers"],
  "ci-cd": ["containers"],
  "react-components": ["js-basics", "functions"],
  "react-state": ["react-components"],
  "react-effects": ["react-components", "async-await"],
  "react-context": ["react-state"],
  "react-performance": ["react-state"],
  "ts-types": ["js-basics"],
  "ts-generics": ["ts-types", "functions"],
  "ts-narrowing": ["ts-types"],
  "node-http": ["http"],
  "node-express": ["node-http"],
  "node-db": ["sql-select", "node-express"],
  "algo-bigo": ["js-basics"],
  "algo-recursion": ["functions"],
  "algo-dp": ["algo-recursion"],
  "algo-graph": ["algo-recursion"],
  "algo-hash": ["js-basics"],
};

// Given a weak skill, return an ordered diagnosis chain from the weakest
// prerequisite root up to the skill, using the learner model's confidence.
// Returns a list of { skill, confidence, isRoot } where isRoot marks the
// actual missing prerequisite to drill.
function diagnose(uid, weakSkill) {
  const { skillConfidence } = require("./learnerModel");
  const visited = new Set();

  function walk(skill) {
    if (visited.has(skill)) return [];
    visited.add(skill);
    const prereqs = SKILL_GRAPH[skill] || [];
    // Recurse depth-first into prerequisites FIRST so deepest nodes come first,
    // giving the true root-of-root. Each prerequisite contributes its own chain.
    const sub = [];
    for (const p of prereqs) sub.push(...walk(p));
    const out = [
      ...sub,
      { skill, confidence: skillConfidence(uid, skill), prereqs },
    ];
    return out;
  }

  const chain = walk(weakSkill);
  // The weakest node (lowest confidence, and PRECEDENCE to deeper/earlier nodes
  // rather than the surface skill) is the likely root cause.
  // Root selection: prefer an ASSESSED weak skill over an unassessed one.
  // "Undefined" (never tested) at the base of the graph usually isn't the real
  // gap — the learner demonstrably progressed past it to reach the weak skill.
  const assessedWeak = chain
    .filter((n) => n.confidence !== undefined && n.confidence < 60)
    .sort((a, b) => {
      const confDiff = a.confidence - b.confidence;
      if (confDiff !== 0) return confDiff;
      return (a.skill === weakSkill ? 1 : 0) - (b.skill === weakSkill ? 1 : 0);
    });
  const root = assessedWeak[0] || chain.find((n) => n.confidence === undefined && n.skill !== weakSkill) || chain.find((n) => n.skill === weakSkill);
  return {
    weakSkill,
    chain,
    root: root || { skill: weakSkill, confidence: skillConfidence(uid, weakSkill) },
  };
}

// Does a skill exist in the graph?
function hasSkill(skill) {
  return skill in SKILL_GRAPH;
}

function getPrereqs(skill) {
  return SKILL_GRAPH[skill] || [];
}

module.exports = { SKILL_GRAPH, diagnose, hasSkill, getPrereqs };
