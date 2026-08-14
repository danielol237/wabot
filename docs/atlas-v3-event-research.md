# Atlas V3 Event Architecture Research

## Verified sources

- GitHub Webhooks: https://docs.github.com/en/webhooks
- GitHub webhook events and payloads: https://docs.github.com/webhooks/webhook-events-and-payloads
- GitHub Actions event triggers: https://docs.github.com/actions/using-workflows/events-that-trigger-workflows
- Render Webhooks: https://render.com/docs/webhooks

## Findings

GitHub supports repository webhooks that deliver selected repository events to an external HTTPS server. Relevant V3 events include `push`, `pull_request`, `check_run`, `check_suite`, `deployment`, `deployment_status`, `issues`, and `issue_comment`. GitHub deliveries include `X-GitHub-Event`, `X-GitHub-Delivery`, and HMAC signature headers; `X-Hub-Signature-256` should be validated with the configured secret. Delivery IDs should be used for idempotency, and the handler should subscribe only to events it actually processes. GitHub payloads can be up to 25 MB, so the endpoint should bound body size.

Render supports workspace webhooks for service events such as build/deploy lifecycle changes, scaling, maintenance, and cron-job completion. Render webhook notifications are HTTPS POST requests and require a public endpoint that returns a 2xx response within 15 seconds. Render uses Standard Webhooks-style headers (`webhook-id`, `webhook-timestamp`, `webhook-signature`) and signs `WEBHOOK_ID.WEBHOOK_TIMESTAMP.REQUEST_BODY.SIGNING_SECRET` with HMAC-SHA256. The event ID is stable across retries, so it can be used for idempotent processing. Render webhooks require a Pro workspace or higher.

## Architecture implication

Atlas V3 should use a durable, owner-scoped Sentinel signal ledger inside the existing bot first. The bot can expose authenticated, signature-verified webhook endpoints for GitHub and Render, normalize accepted events into Atlas signals, deduplicate by source plus delivery ID, derive risks and decision briefs deterministically, and deliver only rate-limited, approval-aware notifications. Existing five-minute proactive monitoring remains a fallback for signals that have no webhook configured. No external action should be triggered directly from an unverified or duplicate event.

## User setup implications

GitHub requires a repository webhook configured to the bot's public HTTPS endpoint and a shared secret. Render requires a workspace webhook, a public endpoint, and a Render webhook signing secret; workspace webhook availability depends on the Render plan. These setup changes should be documented and remain opt-in.
