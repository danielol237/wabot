# ARIA Platform — Production Hosting and Commercial Launch Guide

ARIA is now a **commercial platform**, not only a WhatsApp bot. The production system combines the Baileys WhatsApp runtime with tenant identity, memberships, permissions, audit events, usage metering, billing, the Revenue Engine, Business Autopilot, Academy, Atlas, Anime media, Developer delivery, and the Android Companion bridge.

> **Safety baseline:** live payment capture and outbound Autopilot delivery are disabled by default. Do not enable either capability until the corresponding merchant or delivery provider has been onboarded, verified, and tested in a controlled environment.

## 1. Render deployment contract

The repository already contains the deployment contract used by the live service. Configure the Render service with the following values, or use the committed `render.yaml` Blueprint configuration.

| Render setting | Required value |
|---|---|
| Build command | `bash build.sh` |
| Start command | `bash start.sh` |
| Health check path | `/healthz` |
| Runtime | Node.js 22 compatible environment |
| Persistent storage | Required for `data/`, `sessions/`, and any media/job state that must survive a redeploy |

The build script installs the project-local media runtime, including `yt-dlp`, its JavaScript solver package, `ffmpeg`, and `ffprobe`. A successful catalog page is not sufficient evidence that Anime downloads work; verify `/healthz` and a validated download flow because the media runtime and authorized source resolver are separate controls.

After a deploy, check the following endpoints:

| Endpoint | Expected result | Purpose |
|---|---|---|
| `/healthz/live` | HTTP 200 and `{"ok":true}` | Lightweight process liveness |
| `/healthz` | HTTP 200 with media readiness | Runtime, media, and WhatsApp status |
| `/platform` | HTTP 200 | Public ARIA Platform landing page |
| `/dashboard` | Login page or authenticated dashboard | Operator console |
| `/portal/login` | Learner authentication page | Academy portal |
| `/anime` | Public Anime catalog | Catalog and authorized playback/download surface |

The service may report `whatsappReady: false` after a fresh deploy. That means the web process is healthy but the Baileys session is not currently paired; it is not a substitute for completing the pairing process described below.

## 2. Required production environment variables

Set secrets in Render’s Environment page. Never commit real values to GitHub, and never paste provider keys into public issue comments or generated project files.

| Variable | Required | Description |
|---|---:|---|
| `OWNER_NUMBER` | Yes | Owner WhatsApp number in digits, without a leading `+`. |
| `DASHBOARD_PASSWORD` | Yes | Strong operator-console password. |
| `DASHBOARD_CSRF_SECRET` | Yes | Stable secret for dashboard CSRF tokens. |
| `PORTAL_SESSION_SECRET` | Yes | Stable HMAC secret for Academy learner sessions. |
| `PLATFORM_SESSION_SECRET` | Yes | Stable HMAC secret for tenant workspace sessions. |
| `MEDIA_PROXY_SECRET` | Yes | Secret used to sign authorized Anime playback tokens. |
| `ARIA_PLATFORM_DATA_DIR` | Recommended | Persistent directory for platform identity, tenant, events, usage, billing, jobs, and CRM JSON stores. |
| `ARIA_LIVE_PAYMENTS` | Keep `false` initially | Must remain `false` until live MTN/Orange merchant onboarding and verification are complete. |
| `ARIA_AUTOPILOT_LIVE` | Keep `false` initially | Must remain `false` until an outbound sender, consent policy, and approval operations are verified. |
| `ANIME_DISABLE_WORKER` | No | Use `1` only for CI or local test runs; leave unset in production. |
| `BASE_URL` | Yes for OAuth and links | Public origin, for example `https://wabot-ytal.onrender.com`. Do not add a trailing slash. |

At least one text AI provider must be configured for conversational replies. The exact provider variables remain in `.env.example`; Z.AI variables are intentionally limited to image, video, and vision generation and do not replace the existing text-provider chain.

## 3. WhatsApp pairing and session persistence

ARIA uses Baileys linked-device authentication. On a new or reset session, inspect the Render logs for the QR pairing flow, then open WhatsApp and choose **Linked devices → Link a device**. Scan the displayed QR code. If the deployment uses a configured phone-number pairing flow, follow the pairing-code output instead.

Keep the session directory on persistent storage. On the Render free plan, configure the encrypted Git-backed backup before the first production pairing: `SESSION_GIT_REPO=danielol237/aria-whatsapp-session`, `SESSION_GITHUB_TOKEN` as a fine-grained token limited to that private repository with **Contents: Read and write**, `SESSION_ENCRYPT_KEY` as a dedicated random value of at least 32 characters, and optionally `SESSION_SYNC_INTERVAL` (default 60 seconds). A redeploy without the Baileys session state will cause `whatsappReady` to return to `false` and require pairing again. Do not copy session credentials into source control or send them through chat.

After the first successful pairing, ARIA encrypts and backs up the session automatically, restores it before connecting on boot, and performs a final backup during graceful shutdown. Subsequent code deployments should therefore reuse the existing WhatsApp link unless WhatsApp logs the device out or the backup credentials are changed.

The owner is protected through both normalized phone identity and modern WhatsApp LID handling. Group-admin protection and the anti-admin denylist remain WhatsApp-side controls; the commercial platform layer does not grant a CRM user group-admin powers.

## 4. Tenant workspace launch

Open `/platform` and register a tenant workspace. Registration creates a platform user, tenant, owner membership, signed session, and CSRF token. The authenticated console exposes the workspace overview, Revenue Engine metrics, plans, billing checkout lifecycle, integrations, and Business OS resources.

The owner workspace bootstrapped from `OWNER_NUMBER` is the transitional bridge for WhatsApp, Anime public telemetry, Atlas, and Developer flows. New commercial API operations must resolve a tenant context and use the existing capability checks. Do not introduce a direct cross-tenant read based only on a chat ID, phone number, or dashboard cookie.

The core commercial flow is intentionally explicit:

> **Customer capture → lead qualification → knowledge-backed reply proposal → human approval → scheduled follow-up → order → revenue attribution.**

Business Autopilot may propose and queue work, but it must not send an outbound WhatsApp message while `ARIA_AUTOPILOT_LIVE=false`. A draft or follow-up marked approved is still not proof that an outbound provider has been configured.

## 5. Billing and Cameroon payment readiness

ARIA’s billing catalog is XAF-priced and currently contains Free, Starter, Growth, and Business plans. Checkout is sandbox-first: a plan request creates a pending subscription/payment intent, and access changes only after a permitted reconciliation transition.

| Provider | Required production setup | Current safe behavior |
|---|---|---|
| Manual | Operator-controlled sandbox reconciliation | Available for testing; no external capture |
| MTN MoMo | Official merchant onboarding, callback secret, callback URL, and provider verification | Intent creation is allowed; live success transitions are blocked while live payments are disabled |
| Orange Money | Official merchant onboarding, callback secret, callback URL, and provider verification | Intent creation is allowed; live success transitions are blocked while live payments are disabled |

Configure `MTN_WEBHOOK_SECRET` and `ORANGE_WEBHOOK_SECRET` only after merchant onboarding. Payment callbacks are signature-verified and idempotent. Do not set `ARIA_LIVE_PAYMENTS=true` merely because a webhook endpoint responds; first verify merchant credentials, signatures, status transitions, reconciliation, duplicate delivery behavior, and tenant attribution in the provider sandbox.

## 6. Integration checklist

The authenticated workspace and operator dashboard expose the readiness matrix. Use it as the launch checklist rather than treating an environment variable as proof that a provider is operational.

| Integration | Environment or external setup | Readiness test |
|---|---|---|
| WhatsApp | Pair the Baileys session and persist its session directory | `/healthz` reports `whatsappReady: true`; send a controlled owner message |
| Anime media | Let `build.sh` install `yt-dlp`, `ffmpeg`, and `ffprobe` | `/healthz` reports all media binaries ready; test an authorized stream/download |
| Learner Google sign-in | Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `BASE_URL`, and optionally `GOOGLE_REDIRECT_URI`; add the exact callback in Google Cloud | `https://wabot-ytal.onrender.com/portal/auth/google/callback` is registered and a real test account can sign in |
| Atlas delivery | Configure `GITHUB_WEBHOOK_SECRET` and `RENDER_WEBHOOK_SECRET`; map repository/service identifiers | Send signed GitHub and Render test deliveries and confirm idempotent acceptance/rejection |
| Android Companion | Set `COMPANION_API_KEY`; package `aria.glb` in the Android app; point the client at `/api/companion/chat` | Authenticated chat request returns the ARIA brain response and rate limiting remains active |
| Pinterest batches | Set `PINTEREST_ACCESS_TOKEN` for official results | Request a batch with default 5 images and verify the max-10 guard |
| Z.AI media | Set `ZHIPU_API_KEY` and `ZHIPU_BASE_URL=https://api.z.ai/v1` | Verify image, video, and vision adapters; text providers remain unchanged |
| Vercel delivery | Set `VERCEL_TOKEN`; keep automatic deployment disabled until owner-controlled delivery is verified | Build, verify, and explicitly request deployment; record the returned preview URL |
| MTN/Orange | Complete official merchant onboarding and configure signed callback secrets | Verify sandbox callbacks, idempotency, and blocked live transitions |

## 7. Release verification checklist

Before announcing a commercial release, run the canonical test command from a clean checkout. The expected suite is currently **207 passing tests**, with the safety regression covering tenant isolation, payment gating, and Autopilot non-delivery.

```bash
ANIME_DISABLE_WORKER=1 \
ARIA_PLATFORM_DATA_DIR="$PWD/temp/test-data" \
MEDIA_PROXY_SECRET=ci-media-secret \
PORTAL_SESSION_SECRET=ci-portal-secret \
DASHBOARD_CSRF_SECRET=ci-csrf-secret \
OWNER_NUMBER=12345000000 \
DASHBOARD_PASSWORD=atlas-dashboard-test-password \
npm test

npm audit --audit-level=high
```

The release gate is not complete unless the following conditions are all true:

| Gate | Required result |
|---|---|
| Tenant isolation | A tenant cannot list, update, or order against another tenant’s CRM records |
| Payment safety | MTN and Orange intents remain pending when live payments are disabled |
| Autopilot safety | Approved follow-ups remain unsent when live Autopilot is disabled |
| Auditability | Product operations emit tenant-scoped platform events and audit entries |
| Usage | WhatsApp, Anime, Academy, Atlas, and Developer activity is metered at its product boundary |
| CI | GitHub Actions passes syntax checks, module load smoke tests, dependency audit, and the full test suite |
| Health | Render `/healthz` reports runtime and media readiness |
| Persistence | `data/` and `sessions/` survive a restart or deploy |

## 8. Operational boundaries and pending external actions

The repository-side commercial transition is implemented and merged. The remaining items are environment and provider operations rather than code changes: pair WhatsApp, set the stable platform and portal session secrets, register the Google callback, configure optional Pinterest/Z.AI/Vercel/Companion credentials, and complete MTN/Orange merchant onboarding.

Do not claim that a connector is live because its configuration variable exists. The readiness matrix intentionally distinguishes **connected**, **configured**, **fallback**, **sandbox**, **disabled**, and **needs-config** states. Keep the system in the safer state until a real end-to-end verification has passed.

## 9. Useful URLs for the current deployment

| URL | Use |
|---|---|
| `https://wabot-ytal.onrender.com/platform` | Public ARIA Platform entry point and tenant workspace login |
| `https://wabot-ytal.onrender.com/dashboard` | Operator dashboard |
| `https://wabot-ytal.onrender.com/portal/login` | Learner/Academy authentication |
| `https://wabot-ytal.onrender.com/anime` | Public Anime catalog, streaming, and authorized download flows |
| `https://wabot-ytal.onrender.com/healthz` | Runtime and media readiness |
| `https://wabot-ytal.onrender.com/healthz/live` | Liveness probe |

Keep this document aligned with `.env.example`, `render.yaml`, `docs/aria-platform-core.md`, and the payment research record whenever deployment behavior changes.
