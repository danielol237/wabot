# ARIA Audit — Execution Architecture Classification (audit #37, step 12)

This is the orphan/dead-code + architecture report for the overlapping
"agent / mission / job" modules. Every module is classified as
CONNECTED / PARTIALLY CONNECTED / DEAD / DUPLICATED / BROKEN based on actual
call-graph tracing (who requires it), not on its header comment.

## How to read this
- **CONNECTED**: reached from a real entry point (command router or boot).
- **PARTIALLY CONNECTED**: reachable but only behind an optional/plugin path,
  or its advertised capability isn't fully wired.
- **DEAD**: no caller anywhere (core, plugin, or test).
- **DUPLICATED**: does the same job as another module with no distinct value.
- **BROKEN**: advertised feature that fails or is unreachable in practice.

## The 7 modules

| Module | Lines | Callers | Classification | Notes |
|--------|-------|---------|----------------|-------|
| `src/tools/agent.js` | 64 | commandRouter (`!agent`) | CONNECTED | Single-task agent runner. |
| `src/tools/advancedAgent.js` | 123 | plugins/enhanced.js | CONNECTED (plugin) | Multi-step SEARCH/SCRAPE/CODE/WRITE/THINK/DONE. WRITE+THINK now real (audit #38/#39). |
| `src/tools/multiAgent.js` | 80 | plugins/enhanced.js | CONNECTED (plugin) | Team-project coordinator. |
| `src/tools/orchestrator.js` | 256 | commandRouter (`!delegate`) | CONNECTED | Role-based prompt pipeline. Researcher gets real web search (audit #11). |
| `src/tools/durableMissions.js` | 589 | commandRouter, index.js | CONNECTED | Mission engine: approvals (enforced), lease recovery, ACTION executor (real, audit #12/#13/#14). |
| `src/tools/missionRunner.js` | 92 | index.js | CONNECTED | 24/7 mission resume/report loop. |
| `src/tools/persistentJobs.js` | 161 | plugins/enhanced.js | CONNECTED (plugin) | Flat job list (`!job`). |

## Findings
1. **No module is DEAD or BROKEN.** All 7 have a live caller. Three are
   reachable only through the `enhanced` plugin (which is auto-loaded from
   `plugins/`), the other four from core (`commandRouter` / `index.js`).
2. **Not DUPLICATED in the harmful sense.** Each module drives a distinct
   command surface (`!agent`, `!delegate`, `!job`, mission engine, 24/7 runner).
   The overlap the audit flagged is real at the *concept* level (they all
   "plan → execute → verify"), but they don't shadow each other at runtime.
3. **The honest architecture gap:** all of them funnel into `getAIResponse`
   (single-LLM prompt passes) except the parts already hardened: durable
   Missions' ACTION executor (real git/file/http/whatsapp verbs), the
   researcher's real web search, and advancedAgent's real SEARCH/SCRAPE/CODE/
   WRITE. The rest are prompt pipelines. That is now documented honestly
   (orchestrator header, audit #40) rather than claimed as "agents."

## Recommendation (do not gut blindly)
A full merge of all 7 into one "Agent Runtime" is high-risk and low-value right
now because they are already non-overlapping entry points. The concrete,
safe wins are:
1. Keep durableMissions as the single mission/persistence runtime (it already
   has real action execution, approval enforcement, lease recovery).
2. Keep advancedAgent + multiAgent + persistentJobs as plugin surfaces, but
   note they share the AI call path (no change needed unless behavior regresses).
3. If consolidation is wanted, migrate `persistentJobs` (`!job`) onto
   `durableMissions` first — they're the closest in shape — and remove the
   standalone module only after `!job` is proven to work on the mission engine.

## Last verified
Suite: 67/67 pass. Boot: clean. Commit: 220e043.
