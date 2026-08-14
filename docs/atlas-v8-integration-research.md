# Atlas V8 Connected Delivery — Integration Research

## Verified provider capabilities

GitHub documents repository webhooks and HMAC-SHA256 validation through the `X-Hub-Signature-256` header. The signature is computed over the original request body with the webhook secret; implementations should compare signatures in constant time and must not parse or mutate the body before verification. GitHub’s repository webhook REST API supports listing, creating, reading, updating, and deleting hooks, with repository webhook write permission required for creation or update. The current ARIA webhook receiver already uses raw-body HMAC verification and timing-safe comparison, so V8 should extend its state and UI around that verified path rather than replace it.

Render documents HTTPS webhooks for service events such as build and deploy lifecycle changes. Render signs each delivery using the Standard Webhooks format with `webhook-id`, `webhook-timestamp`, and `webhook-signature`; the signed material is `WEBHOOK_ID.WEBHOOK_TIMESTAMP.REQUEST_BODY.SIGNING_SECRET`. Render expects a 2xx response within 15 seconds and retries failed deliveries up to eight times with exponential backoff. Its event payload includes an event type, timestamp, event ID, service ID, service name, and status for relevant events. The current ARIA receiver already validates the timestamp window, raw body, and signature, and records delivery diagnostics.

## V8 architectural consequence

V8 should start with verified read-only awareness and proposal generation: provider mappings, connection health, repository/branch/PR/check/deployment status, Render build/deploy status, and evidence-linked release-readiness reports. It should not automatically create, update, or delete provider webhooks from the bot. Any provider-side configuration, commit, merge, deployment, rollback, external post, permission change, or spending action must appear as an explicit owner approval proposal and remain unexecuted until approved.

## Sources

1. GitHub Docs, “About validating webhook deliveries,” https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
2. GitHub Docs, “REST API endpoints for repository webhooks,” https://docs.github.com/rest/webhooks/repos
3. Render Docs, “Render Webhooks,” https://render.com/docs/webhooks
