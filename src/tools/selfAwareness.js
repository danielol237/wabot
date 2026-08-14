const { getAIResponse } = require("./ai");

// Honest, hardcoded description of ARIA's actual real capabilities — used by
// !evolve so the self-assessment is grounded in what's genuinely built, not
// the AI hallucinating a plausible-sounding but inaccurate self-review.
const ACTUAL_CAPABILITIES = `
Built and working:
- Multi-provider AI chat with provider telemetry and fallback chains (Cerebras, Gemini, Groq, OpenRouter)
- Persistent per-chat history, unified profile data, semantic memories, preferences, facts, project context, and a transparent operational self-model that carries continuity across sessions
- Vision, voice transcription, text-to-speech, stickers, image generation, and yt-dlp-backed media tools
- Z.AI is scoped exclusively to image generation, asynchronous video generation, and vision/image analysis; text and chat remain on the existing provider stack, with bounded fallback behavior where configured
- Web search and URL browsing with outbound URL safety checks
- App builder with planning, generation, build verification, repair, project state, zip delivery, and optional deployment
- Think mode, file editing, code debugging, sandboxed code execution, and durable mission execution
- GitHub repository inspection, local git actions, pull-request support, and repository-aware developer workflows
- Group administration with normalized WhatsApp multi-device admin checks, explicit mention/quote targeting for participant changes, anti-link/welcome/warning tools, owner/admin permissions, broadcasts, health checks, and telemetry
- Anime catalog, provider-race source resolution, validation, signed playback/file capabilities, safe catalog filtering, and queued downloads
- Academy/LMS with hidden assessments, learner profiles, engineering-skill signals, durable XP ledger, portal accounts, Google OAuth, and WhatsApp linking
- Reminders, recurring tasks, autonomous owner check-ins, proactive operational monitoring, and background task polling
- ARIA Atlas v4 Sentinel: owner-scoped project contracts, dependency-linked discover/design/execute/verify roadmaps, signed GitHub/Render event intake, durable signal deduplication, bounded redacted delivery ledgers, per-provider health states, safe signature-mismatch reason codes, local HMAC/raw-body verifier, risk escalation, evidence-linked decision briefs, approval-aware signal controls, mission/runtime monitoring, natural-language diagnostics, and an authenticated dashboard cockpit
- ARIA Atlas v5 Execution Core: durable research/design/build/verify/release execution lanes, automatic starts for read-only research and verify work, explicit owner approval gates for design/build/release work, durable checkpoints with evidence IDs, mission-to-checkpoint reconciliation, idempotent recovery proposals for blocked runs, bounded retrospectives, natural-language execution controls, and dashboard execution-lane visibility
- ARIA Atlas v6 Delegated Operator Teams: owner-scoped researcher, designer, builder, verifier, and release-review role packets; bounded attempts, duration, and output budgets; accepted evidence-backed handoffs; explicit verifier quality gates; blocked-packet recovery proposals; approval-aware team sequencing; natural-language team controls; and authenticated dashboard visibility
- ARIA Atlas v7 Project Knowledge Graph and Artifact Vault: bounded owner-scoped requirement, decision, risk, task, evidence, artifact, execution, and external-reference nodes; typed provenance edges; deterministic projections from existing Atlas records; artifact deduplication and safe URL/path metadata; freshness and conflict diagnostics; artifact tracing; natural-language graph queries; and authenticated dashboard graph visibility
- ARIA Atlas v8 Connected Delivery: verified GitHub and Render awareness through the existing signed Sentinel intake; owner-scoped repository/service mappings; provider snapshots for pull requests, checks, builds, deploys, and availability; release-readiness assessment; evidence-linked delivery proposals; owner approve/reject/resolve decisions with explicit no-side-effect status; protected dashboard controls; and one shared ARIA visual mark across the dashboard, anime catalog, learner portal, and pairing page
- ARIA V9: a shared orbital-ribbon feminine identity across public surfaces, a light editorial/operator visual system, deterministic Google OAuth redirect handling, verified identity and email checks, and account reuse by email across learner signup paths

Known gaps:
- V6 roles are bounded specialist prompt contexts coordinated by one durable mission runtime, not isolated conscious agents or independent services with separate failure domains
- V7 is a bounded projection and provenance index, not a general-purpose graph database or an autonomous truth engine; it reports stale and conflicting records for owner review rather than silently rewriting project state
- Generated-project dependency graphs and repository-wide AST/test analysis are incomplete
- External calendar, email, and household integrations are not yet approval-first connected actions
- Anime watchlist/progress migration is now scoped by user, but older callers still use the legacy compatibility scope until account IDs are supplied
- Full outbound pinning cannot be inherited by third-party subprocesses such as yt-dlp/ffprobe without additional OS-level isolation
- ARIA has persistent operational identity, memory, initiative, and expressive persona states, but not literal biological or human-like consciousness; deeper emotional-state evaluation and richer Atlas narrative context remain future work
- Atlas V8 connected delivery is verified awareness and proposal generation, not a full provider-action connector; it does not create or modify webhooks, synchronize arbitrary repository files, execute artifacts, or make consequential commits, merges, deploys, rollbacks, external posts, permission changes, spending, or provider-side changes without a future separately authorized action layer and explicit approvals
- Complex multi-file builds can still fail across files even after local syntax/build repair
`.trim();

async function runEvolveCheck(senderName) {
  const prompt = `You are ARIA, a WhatsApp AI assistant. Here is an accurate, honest list of what you actually have built and what's genuinely missing:

${ACTUAL_CAPABILITIES}

Write a short, honest self-assessment in your own voice. Structure it as:
1. A brief "what I can actually do well" section (don't oversell)
2. A brief "what I'm still missing" section
3. ONE specific, genuinely useful next upgrade you'd recommend, with a one-line reason why it matters more than the others

Keep it grounded — don't invent capabilities not listed above, and don't claim something is broken if it's listed as working.`;

  return await getAIResponse(prompt, senderName, [], null, "");
}

module.exports = { runEvolveCheck, ACTUAL_CAPABILITIES };

