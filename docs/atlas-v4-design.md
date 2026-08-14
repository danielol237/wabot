# ARIA Atlas V4 — Sentinel reliability design

## Purpose

Atlas V3 proved the event-to-Sentinel concept but exposed an operational weakness: a provider webhook could be marked enabled while the running service rejected every delivery. V4 makes integration health observable, testable, and repairable without exposing credentials or allowing ARIA to mutate external provider settings automatically.

## State model

Each owner-scoped Atlas workspace keeps a bounded Sentinel state with source mappings, per-provider health, and redacted delivery records.

| State | Meaning | Owner action |
|---|---|---|
| `disabled` | Sentinel is intentionally off. | Enable it from the dashboard if monitoring is wanted. |
| `unconfigured` | Sentinel is on, but no source mapping exists. | Map a GitHub repository or Render service. |
| `attention` | A mapping exists, but no verified delivery has arrived or a non-authentication issue needs review. | Run a provider test and inspect the delivery ledger. |
| `misconfigured` | The running service rejected a delivery because of a missing secret, invalid signature, missing headers, stale timestamp, or unavailable raw body. | Correct the provider/server configuration and redeliver. |
| `healthy` | A verified provider delivery was accepted. | No action is required unless later failures appear. |

A delivery record contains only a provider, delivery ID, event name, status, reason code, HTTP status, timestamps, duration, source mapping, and boolean metadata indicating whether a signature and exact raw body were available. V4 never stores a webhook secret or raw payload in the delivery ledger.

## Diagnostic paths

The authenticated dashboard exposes **Diagnose connections** and **Test local verifier**. The first reads provider health and recent deliveries. The second signs a local fixture using the running environment secret and verifies the local HMAC/raw-body path. It explicitly reports that it is not a GitHub delivery test, preventing a false green state when the provider-side secret is wrong.

The WhatsApp brain accepts no-prefix requests including “diagnose integrations,” “check the webhook connection,” “integration health,” and “show delivery diagnostics.” These requests are read-only. They explain the current reason code and next safe action; they do not rotate secrets, edit GitHub settings, redeploy Render, or approve consequential changes.

## Webhook behavior

The GitHub route continues to verify `X-Hub-Signature-256` against the exact raw request bytes using a constant-time comparison. V4 adds reason-coded outcomes for missing environment secret, missing signature, unexpected user agent, missing delivery ID, raw-body loss, invalid signature, missing event header, processing error, workspace unmapped, accepted delivery, and duplicate delivery. Render receives equivalent missing-secret, timestamp, raw-body, signature, processing, unmapped, accepted, and duplicate diagnostics.

A valid request is acknowledged quickly with HTTP 202 after normalization. Authentication failures remain 401 or 503 as appropriate, because provider delivery systems need a non-2xx response to record the attempt as failed. The dashboard retains enough metadata to explain that failure without asking the owner to guess or share a credential.

## Approval boundary

V4 is an observability and proposal layer. It can record a delivery, classify a failure, attach evidence through the existing Sentinel normalization path, and present a safe remediation proposal. It cannot rotate credentials, call GitHub’s settings API, modify Render environment variables, redeploy a service, post externally, or make a release decision without explicit owner approval and the existing action-policy gates.

## Rollout

V4 is backward-compatible with existing Atlas workspaces. On read, legacy Sentinel records are normalized into the V4 schema. After deployment, the owner should open the Atlas workspace, confirm the source mapping, use **Test local verifier**, then use **Diagnose connections**, and finally redeliver a provider test. A healthy local verifier with a misconfigured provider delivery correctly indicates that the remaining mismatch is outside the local HMAC implementation.
