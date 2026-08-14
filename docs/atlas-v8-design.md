# ARIA Atlas V8 — Connected Delivery and Product Design System

## Goal

V8 is the final planned Atlas foundation release. It turns the existing verified GitHub and Render webhook monitoring into a clear connected-delivery control surface, while unifying the dashboard, ARIA Anime, learner portal, and owner pairing pages around a practical, responsive ARIA identity.

V8 does not grant ARIA unrestricted external power. It improves visibility, evidence, proposals, and owner decision-making. Provider-side changes remain explicitly approved and are not carried out automatically by this release.

## Connection model

V4 already verifies signed webhook deliveries and normalizes GitHub and Render events. V8 adds a persistent `connectedDelivery` workspace model that records whether a GitHub repository and Render service are mapped, which branch and environment they represent, the latest verified change/check/build/deploy state, any open release proposal, and its owner decision history.

| Layer | V8 behavior | Not allowed automatically |
|---|---|---|
| GitHub awareness | Records verified pull-request, check, deployment, and merge events; maintains release-readiness evidence. | Creating webhooks, commits, pushes, merges, review submissions, or repository setting changes. |
| Render awareness | Records verified build, deploy, availability, restart, and failure events; explains live delivery status. | Deploying, rolling back, restarting, scaling, changing a plan, or modifying secrets. |
| Proposal ledger | Builds explicit owner-facing proposals from verified evidence, such as “review failing CI” or “approve deployment investigation.” | Executing a proposal merely because it was generated or acknowledged. |
| Owner approval | Allows an owner to approve, reject, or resolve a proposal and records the choice. | Treating approval as provider-side execution unless a later separately approved connector/action layer exists. |

GitHub’s webhook signature validation uses the original request body and `X-Hub-Signature-256`; Render signs `webhook-id.webhook-timestamp.request-body.signing-secret` and expects a prompt 2xx response. The current receiver already implements these controls, so V8 extends that verified intake instead of parsing raw provider events a second way. [1] [2]

## Connected-delivery state

Each workspace has one bounded record:

```text
connectedDelivery = {
  version, enabled,
  github: { repository, defaultBranch, lastEvent, lastCheck, lastPullRequest, lastMergeAt },
  render: { serviceId, serviceName, environment, lastEvent, lastBuild, lastDeploy, availability },
  release: { status, evidenceIds, signalIds, proposalId, lastAssessedAt },
  proposals: [ { id, kind, title, rationale, evidenceIds, status, createdAt, decidedAt } ]
}
```

The release status is deliberately descriptive, not a deploy command: `not_configured`, `observing`, `needs_review`, `blocked`, `ready_for_owner_review`, `approved_no_side_effect`, `released_verified`, or `unknown`. A status is derived only from verified evidence and does not guarantee that a provider action happened.

## Event rules

A failed GitHub check, failed Render build, failed Render deploy, unavailable Render server, or failed provider delivery moves the release state to `needs_review` or `blocked`, creates durable evidence, and may create an owner proposal. A successful verified deployment or successful merged pull request becomes release evidence but does not overwrite an active failure until the related issue is resolved. Every update is idempotent by provider delivery ID or normalized event identity.

## Proposal boundary

V8 proposals have four deterministic levels: `observe`, `prepare`, `propose`, and `commit`. This release supports observe, prepare, and propose only. An owner can record `approve`, `reject`, or `resolve`; `approve` becomes an evidence-backed intent, explicitly labelled `approved_no_side_effect` until a later external action connector is configured and separately authorized.

## Natural-language surface

The owner can say:

- “Show connected delivery.”
- “Is this release ready?”
- “What failed in GitHub or Render?”
- “Show deployment evidence.”
- “Show delivery proposals.”
- “Approve delivery proposal <id>.”
- “Reject delivery proposal <id>.”
- “Resolve delivery proposal <id>.”

No prefix is needed. Responses name the underlying evidence and are clear about whether ARIA observed, prepared, proposed, or actually executed anything.

## V8 dashboard cockpit

The Atlas cockpit receives a Connected Delivery panel showing repository, branch, service, environment, last verified events, release status, current evidence, and proposals. A mapping form remains owner-authenticated and CSRF-protected. It records a repository/service mapping only; it does not create a provider webhook or store a secret. The dashboard explains the exact callback endpoints and the required environment-variable secrets for manual provider setup.

## Shared ARIA design system

The product family uses one mark and a small semantic token set rather than repeating unrelated CSS-built letters. The mark is an abstract `A` signal: a clean split apex plus a small orbit/continuity point. It should work in a 20px favicon context, a 36–48px app mark, and a monochrome setting. The shared visual language is intentionally restrained: near-black ink, slate surfaces, warm coral for primary action, mineral teal for verified or connected state, and high contrast typography.

| Surface | Primary job | V8 design direction |
|---|---|---|
| Owner dashboard | Make operational decisions safely. | Dense but calm control-room hierarchy, strong status language, fixed navigation, compact actionable panels. |
| ARIA Anime | Help visitors find, watch, and download from configured authorized sources. | Editorial catalog treatment, readable art-first hierarchy, direct watch/download affordances, stable mobile controls. |
| Learner portal | Build trust at login and make learning progress understandable. | Quiet academic workspace, smaller brand footprint, plain-language authentication, obvious next learning action. |
| Pairing screen | Complete an owner-only connection quickly. | Single-purpose card, generous QR/code focus, no distracting controls, shared mark and clear status. |

## Responsive acceptance rules

Every live page must be checked at 360px, 390px, 768px, and desktop width. Navigation, search, forms, buttons, cards, QR/pairing content, video controls, download state, and login controls must remain reachable with no accidental horizontal overflow. The public anime site should keep watch and download choices distinct; the owner dashboard should keep destructive/consequential controls visually separated from observation; and the learner portal should retain its separate secure session and OAuth behavior.

## Deferred provider setup

The user’s GitHub connector is enabled for this task, but a Render connector is not currently configured. V8 therefore implements the safe product and setup surfaces first. Actual webhook configuration requires user-controlled provider settings and secrets: `GITHUB_WEBHOOK_SECRET` and `RENDER_WEBHOOK_SECRET` in the running service, plus GitHub repository webhook and Render workspace webhook entries pointing to the existing signed endpoints. GitHub and Render credentials are not stored in Atlas workspace JSON.

## References

[1] [GitHub Docs — Validating webhook deliveries](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)

[2] [Render Docs — Webhooks](https://render.com/docs/webhooks)
