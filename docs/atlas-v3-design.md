# ARIA Atlas V3 Sentinel Design

## Goal

Atlas V3 adds a proactive operating layer to the merged V2 project brain. Sentinel receives approved signals, turns them into durable owner-scoped project evidence, derives risks and decision briefs deterministically, and notifies the owner only when a signal is actionable. It does not execute commits, deploys, posts, or other consequential side effects merely because an event arrived.

## Runtime choice

V3 remains inside the existing Node.js/Express bot deployed on Render. This preserves the current WhatsApp socket, owner authentication, Atlas JSON persistence, and dashboard. The service exposes two opt-in HTTPS webhook routes and keeps the existing five-minute local monitor as a fallback for signals that do not have an external webhook configured.

| Approach | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|
| Extend the existing Render bot with signed webhook routes and the current monitor loop | Reuses Atlas persistence, WhatsApp delivery, and dashboard; the bot becomes responsible for webhook verification and rate limiting | No new service; Render webhook availability depends on the workspace plan | Moderate: configure secrets and repository/service mappings |
| Run a separate event gateway and connect it to the bot | Isolates webhook traffic and can scale independently, but adds another deployment, persistence boundary, secret set, and notification bridge | Additional service and operational overhead | High: separate hosting, routing, storage, and bot integration |

Because this request extends the existing bot and Render deployment, V3 uses the first approach. The second remains a future scale-out option if webhook traffic or integration count grows materially.

## Durable workspace state

Each Atlas workspace receives a Sentinel configuration, signal ledger, and decision-brief ledger:

- `sentinel.enabled`: explicit opt-in switch.
- `sentinel.sources.github.repository`: optional `owner/repository` mapping.
- `sentinel.sources.render.serviceId`: optional Render service mapping.
- `sentinel.lastPassAt`: timestamp of the latest local Sentinel pass.
- `signals[]`: bounded, normalized signals with source, kind, dedupe key, severity, status, evidence/risk links, and delivery timestamps.
- `briefs[]`: bounded decision briefs with impact, recommendation, action level, approval state, and source signal ID.

Webhook payloads are never persisted wholesale. Only normalized, bounded fields are stored so secrets, oversized payloads, and unrelated provider data do not become project history.

## Event lifecycle

1. The HTTPS endpoint accepts a request only after validating the source signature and timestamp/body limits.
2. Sentinel derives a stable dedupe key from the source plus provider delivery/event ID.
3. It resolves the signal to an explicitly configured owner workspace.
4. It stores the normalized signal once; duplicate deliveries return success without creating duplicate risks or briefs.
5. A deterministic rule maps the signal to severity, evidence, risk changes, and a decision brief.
6. High-severity briefs may be sent to the owner through WhatsApp subject to cooldowns. Notifications are informative and approval-aware.
7. Owner actions such as acknowledge, resolve, or approve a proposed next step are explicit and authenticated.

## Initial signal rules

| Source event | Signal meaning | Default severity | Sentinel response |
|---|---|---:|---|
| GitHub `check_run`/`check_suite` failure | CI or verification regression | high | Add evidence, open a risk, recommend inspecting the failed check |
| GitHub `pull_request` opened/changed | Change entering review | medium | Add evidence and propose review/verification |
| GitHub `pull_request` merged | Approved change landed | info | Add evidence and resolve matching stale change risk when possible |
| GitHub `deployment_status` failure | Release health regression | critical | Add evidence, open a high-impact risk, notify owner |
| Render `deploy_ended` failed/canceled | Deployment did not complete successfully | critical | Add evidence, open a high-impact risk, notify owner |
| Render `deploy_ended` succeeded | Deployment completed | info | Add release evidence and resolve the matching deployment risk |
| Local stalled mission | Durable work has stopped moving | high | Link the mission to Atlas, open a risk, propose review/retry/cancel |
| Local repeated bot/provider failure | Operational reliability regression | medium/high | Add a reliability signal and decision brief |

## Approval model

Sentinel classifies signal handling as `observe`, `prepare`, `propose`, or `commit`, matching the existing Atlas policy. Observation, normalization, evidence creation, and risk calculation are safe. A recommendation to retry, change a plan, commit code, deploy, or send an external post is a proposal. Commit-class actions remain blocked until the owner explicitly approves them through the existing approval mechanisms.

## Security requirements

GitHub requests must validate `X-Hub-Signature-256` using HMAC-SHA256, check the expected GitHub user-agent prefix, bound the body size, and deduplicate on `X-GitHub-Delivery`. Render requests must validate the Standard Webhooks-style `webhook-id`, `webhook-timestamp`, and `webhook-signature` over `WEBHOOK_ID.WEBHOOK_TIMESTAMP.REQUEST_BODY.SIGNING_SECRET`, reject stale timestamps, bound the body size, and deduplicate on the stable event ID. Webhook endpoints do not accept user-selected workspace IDs; source mappings determine ownership.

## Dashboard and language surface

The Atlas cockpit gains a Sentinel panel with enablement, configured sources, latest signals, open risks, and decision briefs. New owner-only natural-language intents include “show Sentinel,” “show project signals,” “what changed in the project,” “acknowledge signal <id>,” and “resolve signal <id>.” These commands read or update only the owner’s selected workspace.

## Rollout

V3 ships with Sentinel disabled unless configured. To activate it, the owner sets the GitHub and/or Render signing secret, configures a repository/service mapping, enables Sentinel for the workspace, and points the provider webhook to the bot’s HTTPS endpoint. Existing local monitoring continues to work without external webhook setup.
