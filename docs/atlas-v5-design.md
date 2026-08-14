# ARIA Atlas V5 — Execution Core design

## Goal

Atlas V5 turns an approved Atlas roadmap into an explainable execution system. V2 planned work, V3/V4 observed external and local signals, and V5 adds controlled execution lanes, evidence checkpoints, durable progress, and retrospectives. GitHub and Render linking remain intentionally deferred until the product build is complete.

## Architecture options

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|
| Extend the existing durable mission engine | Reuses atomic mission storage, leases, approvals, retries, and the existing ten-minute runner. Execution records remain close to Atlas state. | Lowest; no additional service | Low |
| Add a separate execution worker | Stronger isolation and independent scaling, but introduces a second process, queue semantics, deployment, health, and operational surface. | Higher hosting and maintenance cost | High |

V5 uses the first approach for this release. It keeps the behavior inside the existing Render bot, preserves the current durable mission safety mechanisms, and does not add another integration or service setup step.

## Execution lanes

Each execution run belongs to one explicit lane:

| Lane | Purpose | Default action policy |
|---|---|---|
| `research` | Gather facts and project evidence. | Observe/prepare; no external mutation. |
| `design` | Convert evidence into a reviewed implementation or decision plan. | Prepare/propose; owner review required for commitment. |
| `build` | Perform bounded local or repository work through existing mission actions. | Proposal/commit depending on action; dangerous operations stay gated. |
| `verify` | Run tests, checks, and evidence collection against a defined acceptance criterion. | Observe/prepare. |
| `release` | Prepare deployment or external publication actions. | Explicit approval required before commit/deploy/post. |

A run can have one active lane and a finite ordered set of checkpoints. A lane is not a new arbitrary executor; it is an execution contract attached to a durable mission and Atlas task.

## Durable run model

The owner-scoped workspace stores bounded execution records with:

- a stable run ID, workspace ID, task ID, mission ID, lane, objective, and owner;
- lifecycle state: `draft`, `awaiting_approval`, `running`, `checkpoint`, `blocked`, `completed`, `failed`, or `cancelled`;
- checkpoint records containing an acceptance criterion, status, evidence IDs, notes, and timestamps;
- a proposed next action and a policy classification;
- an optional retrospective containing outcome, what worked, what failed, and the next improvement;
- idempotency keys so mission reconciliation cannot duplicate checkpoints or retrospective entries.

Execution records are bounded per workspace. Secrets, provider payloads, and arbitrary untrusted instructions are not persisted into this model.

## Checkpoints and reconciliation

A checkpoint is complete only when it has a verifiable evidence record or an explicit owner decision explaining why evidence is unavailable. Terminal durable mission outcomes update the linked execution run and Atlas task exactly once. A failed mission creates a blocked checkpoint and a proposed recovery brief; it does not silently mark the task complete. A successful mission creates evidence and advances the next checkpoint only when its dependency and approval policy allow it.

## Approval boundary

Drafting a run, selecting a lane, preparing a checklist, collecting evidence, and proposing a recovery are safe operations. Starting a run that only performs read-only research or verification can proceed automatically. File writes, repository mutations, commits, deployments, permission changes, external posts, spending, and deletion remain approval-gated through the existing Atlas policy and mission approval flow.

A single owner approval applies only to the exact proposed action set and expires with the run’s approval request. Rejecting an approval marks the related checkpoint as rejected and prevents an automatic retry loop.

## Natural-language surface

The owner can say:

- “Execute the next safe step.”
- “Start a research run for this task.”
- “Show execution status.”
- “Pause the execution.”
- “Approve the next execution step.”
- “What evidence is missing?”
- “Retrospect this run.”
- “Propose recovery for the failed run.”

These phrases inspect or operate the owner’s workspace and never bypass permission checks.

## Deferred integrations

No GitHub or Render linking is required for the V5 build or verification. V5 can execute local mission work, record evidence, and verify local acceptance criteria first. Provider connections remain a later rollout step after the execution model and UI are stable.
