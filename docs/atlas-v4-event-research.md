# ARIA Atlas V4 — Event reliability research

## Verified GitHub behavior

GitHub signs webhook deliveries with the `X-Hub-Signature-256` header using HMAC-SHA256 over the original request payload and the configured webhook secret. The secret must be high-entropy, stored securely on the receiving server, and kept identical between GitHub and the server environment. Verification must use the original payload bytes and a constant-time comparison. GitHub specifically advises checking the secret, header, algorithm, encoding, and whether a proxy or load balancer altered the payload or headers.

GitHub records failed deliveries as invalid HTTP responses when the receiver returns a 4xx or 5xx status. Recent deliveries expose request headers, payload, timestamp, and the received response, and can be redelivered for the previous three days. This means V4 should retain a redacted delivery ledger with status, provider, delivery ID, event name, reason category, and retry/test metadata, but never persist secrets or raw payloads by default.

## V3 incident diagnosis

The observed GitHub `401` proves that GitHub reached the Render endpoint but the receiver rejected the request. The current V3 route has only generic `401` and `503` responses and does not persist an operator-facing diagnostic. The most likely classes are secret mismatch, missing `X-Hub-Signature-256`, missing environment secret after deploy, stale Render deployment, or altered raw bytes. V4 should distinguish these classes without revealing secret material.

## V4 reliability contract

1. Every webhook attempt gets a durable, bounded delivery record before authentication completes.
2. Records contain only safe metadata: provider, delivery ID, event type, received time, response class, reason code, retry count, and matched workspace ID when known.
3. Secrets are never logged, displayed, hashed for comparison in a user-facing way, or returned through APIs.
4. The dashboard shows `healthy`, `attention`, `misconfigured`, or `disabled` instead of only `enabled`.
5. Owners can run a signed self-test and see the exact next action. A self-test must not pretend to be a provider delivery if it was locally generated.
6. Recovery proposals remain approval-gated. V4 may explain that a secret is missing or that a webhook is returning 401, but it must not rotate credentials, edit GitHub settings, or redeploy without explicit approval.
7. Provider deliveries must return 2xx quickly; normalization and notification can be performed after the acceptance response where safe.

## Official sources

- https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
- https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/troubleshooting-webhooks
- https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries
- https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/redelivering-webhooks
