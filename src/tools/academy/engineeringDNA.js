// ── ARIA Academy — Engineering DNA / Career Roadmap ──────────────
// The visualization layer. It reads the learner model + skill graph and
// produces:
//   • your Engineering DNA — the shape of your strengths across skill clusters
//   • your best-fit engineering career path (computed, not guessed)
//   • the roadmap — which skills to build next to reach that path
//
// Career paths are scored by how much of their required skill cluster you
// already demonstrate. Fit = weighted coverage of that role's core skills.

const { learner, skillConfidence } = require("./learnerModel");
const { SKILL_GRAPH, getPrereqs } = require("./skillGraph");
const { recallHealth } = require("./forgettingEngine");

// Cluster → skills map (a skill can belong to multiple clusters).
const CLUSTERS = {
  "JavaScript core": ["js-basics", "variables", "functions", "scope", "closures", "callbacks", "promises", "async-await", "error-handling", "event-loop", "concurrency"],
  "Frontend / React": ["react-components", "react-state", "react-effects", "react-context", "react-performance"],
  "Backend / Node": ["http", "node-http", "node-express", "node-db", "rest-apis", "json", "auth"],
  "Databases": ["sql-basics", "sql-select", "sql-joins", "sql-group", "sql-index", "sql-transactions"],
  "DevOps / Cloud": ["linux-basics", "docker-basics", "containers", "kubernetes", "ci-cd"],
  "TypeScript": ["ts-types", "ts-generics", "ts-narrowing"],
  "Algorithms": ["algo-bigo", "algo-recursion", "algo-dp", "algo-graph", "algo-hash"],
};

// Career roles and the clusters that matter most to them.
const CAREERS = [
  { role: "Frontend Engineer", emoji: "🎨", weight: { "JavaScript core": 2, "Frontend / React": 3, "Algorithms": 1, "TypeScript": 2 } },
  { role: "Backend Engineer", emoji: "⚙️", weight: { "JavaScript core": 2, "Backend / Node": 3, "Databases": 2, "Algorithms": 1 } },
  { role: "Full-Stack Engineer", emoji: "🦾", weight: { "JavaScript core": 2, "Frontend / React": 2, "Backend / Node": 2, "Databases": 2, "Algorithms": 1 } },
  { role: "DevOps / SRE", emoji: "☁️", weight: { "DevOps / Cloud": 3, "Backend / Node": 1, "Databases": 1, "Algorithms": 1 } },
  { role: "Data Engineer", emoji: "📊", weight: { "Databases": 3, "Algorithms": 2, "Backend / Node": 1, "JavaScript core": 1 } },
  { role: "Systems / Backend + DB", emoji: "🗄️", weight: { "Databases": 3, "Backend / Node": 2, "DevOps / Cloud": 1, "JavaScript core": 1 } },
];

// Confidence for a cluster (avg of assessed skills; unassessed don't penalize,
// but the % is of assessed so a role with more coverage scores higher).
function clusterConfidence(uid, cluster) {
  const skills = CLUSTERS[cluster] || [];
  const assessed = skills.filter((s) => skillConfidence(uid, s) !== undefined);
  if (!assessed.length) return { score: 0, assessed: 0, total: skills.length };
  const avg = assessed.reduce((a, s) => a + skillConfidence(uid, s), 0) / assessed.length;
  // Coverage: fraction of the cluster's skills you've touched.
  const coverage = assessed.length / skills.length;
  return { score: Math.round(avg * coverage), assessed: assessed.length, total: skills.length };
}

// DNA = cluster scores, sorted strong → weak.
function engineeringDNA(uid) {
  const clusters = Object.entries(CLUSTERS).map(([name]) => ({
    cluster: name,
    ...clusterConfidence(uid, name),
  }));
  return clusters.sort((a, b) => b.score - a.score);
}

// Best-fit career path(s).
function careerFit(uid) {
  const dna = engineeringDNA(uid);
  const scores = CAREERS.map((c) => {
    let num = 0, den = 0;
    for (const [cluster, w] of Object.entries(c.weight)) {
      const conf = dna.find((d) => d.cluster === cluster)?.score || 0;
      num += conf * w;
      den += w;
    }
    return { role: c.role, emoji: c.emoji, fit: Math.round((num / den)) };
  });
  const ranked = scores.sort((a, b) => b.fit - a.fit);
  const top = ranked[0];
  return { ranked, top, topCluster: dna[0]?.cluster };
}

// The roadmap: what to build next for the best-fit role.
function roadmap(uid, topRole) {
  const career = CAREERS.find((c) => c.role === topRole);
  const dna = engineeringDNA(uid);
  // For the role's weighted clusters, find skills not yet assessed (gaps).
  const gaps = [];
  for (const [cluster, w] of Object.entries(career.weight)) {
    if (w < 2) continue; // only core clusters drive the roadmap
    for (const skill of CLUSTERS[cluster] || []) {
      if (skillConfidence(uid, skill) === undefined) gaps.push(skill);
    }
  }
  // Order gaps by dependency depth (prerequisites first).
  const depth = (s) => { const p = getPrereqs(s); return p.length ? 1 + Math.max(...p.map(depth), 0) : 0; };
  gaps.sort((a, b) => depth(a) - depth(b));
  // Dedupe.
  return [...new Set(gaps)].slice(0, 8);
}

// Full report.
function dnaReport(uid) {
  const dna = engineeringDNA(uid);
  const fit = careerFit(uid);
  const top = fit.top;
  const roadmapSkills = roadmap(uid, top.role);
  const recall = recallHealth(uid);
  const l = learner(uid);

  const lines = [];
  lines.push(`🧬 *Engineering DNA*`);
  lines.push(`\n*XP:* ${l.xp || 0} · *Streak:* ${l.streak || 0}d · *Attempts:* ${l.attempts.length} · *Recall health:* ${recall.health}%`);

  lines.push(`\n*Skill clusters (strong → weak):*`);
  for (const c of dna) {
    const bar = "▰".repeat(Math.round(c.score / 20)) + "▱".repeat(5 - Math.round(c.score / 20));
    lines.push(`• ${c.cluster}: ${bar} ${c.score}% (${c.assessed}/${c.total} skills)`);
  }

  lines.push(`\n*Best-fit career:* ${top.emoji} ${top.role} (${top.fit}% fit)`);
  const other = fit.ranked.slice(1, 3).map((r) => `${r.role} ${r.fit}%`).join(" · ");
  lines.push(`Runners-up: ${other}`);

  if (roadmapSkills.length) {
    lines.push(`\n*Roadmap to ${top.role} (learn next, prerequisites first):*`);
    roadmapSkills.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  } else {
    lines.push(`\nYou've touched all core skills for ${top.role}. Go build real projects to lock it in. 💪`);
  }
  lines.push(`\n_This is computed from your demonstrated competence + recall strength — not XP._`);
  return lines.join("\n");
}

module.exports = { CLUSTERS, CAREERS, engineeringDNA, careerFit, roadmap, dnaReport, clusterConfidence };
