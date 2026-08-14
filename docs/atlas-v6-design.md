# ARIA Atlas V6 — Delegated Operator Teams

## Purpose

Atlas V5 gave ARIA a durable execution core: explicit lanes, approval gates, evidence checkpoints, mission reconciliation, recovery proposals, and retrospectives. V6 adds a controlled **operator team** layer above that core. The team is not a claim that ARIA contains independent conscious beings; it is a durable sequence of specialised role packets executed by the existing mission runtime and coordinated through one Atlas workspace.

The design keeps the current Render bot architecture. It does not introduce a second worker service, provider integration, autonomous deployment path, or hidden external side effect. Each role receives a bounded packet, writes a bounded handoff, and stops when its budget or acceptance criteria are exhausted.

## Architecture choice

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---:|---:|
| Extend Atlas V5 with durable operator teams | Reuses owner-scoped workspaces, missions, evidence, checkpoints, leases, and approval controls. The same bot process coordinates the team. | Lowest; no new service | Low–medium |
| Add a separate role-worker service | Better process isolation and independent scaling, but adds a queue, deployment, health, secrets, and cross-service consistency problem. | Higher hosting and maintenance | High |

V6 uses the first approach. A team is a durable Atlas record containing ordered role packets; each packet may link to one durable mission. The existing ten-minute runner reconciles missions and advances eligible handoffs. The system remains honest that roles are specialised execution contexts, not separate conscious agents.

## Role model

The initial team has five operator roles. Their prompts and acceptance criteria are fixed in code, while the project objective and evidence are workspace-specific.

| Role | Responsibility | Default output | Side-effect policy |
|---|---|---|---|
| Researcher | Gather relevant facts, constraints, alternatives, and source-backed evidence. | Findings, sources, unresolved questions, recommended design inputs. | Read-only; no external mutation. |
| Designer | Turn research into a bounded implementation proposal with acceptance criteria and dependencies. | Proposed approach, files/surfaces, risks, acceptance criteria, owner decisions needed. | Prepare/propose; no commit or deploy. |
| Builder | Produce the bounded local artifact or implementation work described by the approved packet. | Work summary, changed surfaces, tests or checks run, remaining gaps. | Consequential work remains behind the existing execution approval policy. |
| Verifier | Check the result against explicit acceptance criteria and attached evidence. | `PASS`, `BLOCKED`, or `NEEDS_REVIEW`, with evidence and failures. | Read-only by default. |
| Release reviewer | Assess release readiness, rollback plan, and unresolved risks. | Release recommendation, required approvals, and rollback notes. | Never deploys or posts; owner approval remains mandatory. |

The team executes in this order: **researcher → designer → builder → verifier → release reviewer**. A packet is not started until its predecessor has produced an accepted handoff, except when the owner explicitly starts a narrower read-only team containing only research or verification.

## Durable records

Each workspace stores a bounded `operatorTeams` array. A team contains an ID, objective, state, role packets, current role index, budgets, approval state, handoff IDs, blocked reason, and timestamps. Each packet contains a stable ID, role, status, objective, input handoff IDs, mission ID, output handoff ID, budget counters, acceptance criteria, and timestamps.

Each handoff is stored in a bounded team-local array and contains the source role, destination role, summary, evidence IDs, decisions, unresolved questions, acceptance status, and creation time. The handoff is the only context that crosses role boundaries by default. Raw provider payloads, credentials, and arbitrary untrusted instructions are not persisted.

| Resource | Default bound |
|---|---:|
| Teams per workspace | 20 |
| Role packets per team | 5 |
| Handoffs per team | 30 |
| Role missions per team | 5 |
| Maximum role duration | 15 minutes |
| Maximum role attempts | 2 |
| Maximum output size | 4,000 characters |

## State machine and handoffs

A team begins in `draft`. Research-only and verify-only teams may enter `running` without approval. A full team enters `awaiting_approval` before the first consequential packet or whenever the next packet’s execution policy is consequential. A packet may be `pending`, `awaiting_approval`, `running`, `completed`, `blocked`, `needs_review`, or `skipped`. A team becomes `completed` only when every required role has an accepted handoff. It becomes `blocked` when a role exhausts its attempts, times out, fails its acceptance gate, or requires an owner decision.

A successful role output becomes a durable evidence record and a structured handoff. The next role receives only the objective, accepted prior handoff summaries, relevant evidence IDs, project constraints, and its own acceptance criteria. This prevents uncontrolled context growth and makes every transition inspectable.

The verifier and release reviewer are quality gates. A verifier output without an explicit `STATUS: PASS` is treated as `NEEDS_REVIEW`, not success. A release recommendation can never directly trigger a deploy, commit, external post, permission change, spending, or deletion. Those actions remain controlled by V5’s approval policy and mission engine.

## Budgets and recovery

Every packet tracks attempts, elapsed time, and output size. A timeout or malformed role result creates a blocked packet with a bounded recovery proposal. Recovery may recommend retrying the same role with narrower context, skipping a non-required role, or requesting an owner decision. V6 never loops indefinitely and never silently retries a consequential role.

Team reconciliation is idempotent. The same mission status, packet ID, or handoff ID cannot create duplicate evidence or advance the same role twice. A restart can resume a pending read-only packet through the durable mission lease; a consequential packet returns to its approval boundary.

## Natural-language surface

The owner can say:

- “Start an operator team for this project.”
- “Start a research team.”
- “Show team status.”
- “Show the current team handoff.”
- “Approve the next team role.”
- “Pause the operator team.”
- “Why is the team blocked?”
- “Review the team’s release readiness.”
- “Retrospect the operator team.”

These phrases are owner-scoped and route through Atlas. No prefix is required. V6 does not remove the existing legacy compatibility path.

## Dashboard cockpit

The Atlas dashboard adds an Operator Teams panel beside the V5 execution panel. It shows active team state, current role, packet progress, budgets, the latest accepted handoff, blocked reasons, and owner decisions required. The panel exposes only authenticated, CSRF-protected actions: start a read-only team, approve, pause, retry a blocked packet, and record a retrospective. It never exposes an unguarded deploy or commit action.

## Deferred integrations

GitHub and Render linking remain deferred. V6 must prove that role packets, handoffs, budgets, evidence, and approval gates work with local missions and project state before provider-side actions are connected.
