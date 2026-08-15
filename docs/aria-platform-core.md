# ARIA Platform Core — Foundation Contract

## Purpose

The platform core is the transitional boundary between the existing ARIA WhatsApp bot and the commercial ARIA Platform. It is intentionally implemented beside the existing modules rather than replacing them in one risky rewrite.

The core currently provides normalized identities, tenants and memberships, role capabilities, idempotent events, audit records, usage metering, configurable plan entitlements, subscriptions, sandbox payment intents, and a tenant-scoped Business OS model.

## Runtime modules

| Module | Contract | Current storage |
|---|---|---|
| `src/core/identity` | Normalize WhatsApp, email, Google, and internal identities; create users; link identities. | Transitional atomic JSON repository |
| `src/core/identity/tenants.js` | Create workspaces, owner membership, and tenant memberships. | Transitional atomic JSON repository |
| `src/core/permissions` | Map roles to capabilities and reject unauthorized operations. | In-code role catalog |
| `src/core/events` | Publish versioned, idempotent domain events with actor, tenant, aggregate, and correlation context. | Transitional atomic JSON repository |
| `src/core/events/audit.js` | Record security and operational actions as `audit.*` events. | Shared event store |
| `src/core/usage` | Meter AI, media, automation, knowledge, and business usage. | Transitional atomic JSON repository |
| `src/core/billing` | Plans, entitlements, subscriptions, payment intents, webhook signatures, and provider status. | Transitional atomic JSON repositories |
| `src/core/business/crm.js` | Customers, conversations, leads, knowledge, follow-ups, orders, and revenue summary. | Transitional atomic JSON repository |
| `src/core/business/autopilot.js` | Lead qualification, hot-lead recommendations, due-follow-up proposals, approval, and gated execution. | Shared CRM repository plus event backbone |
| `src/core/business/observer.js` | Capture only clear private WhatsApp sales intent into customers, leads, and conversations. | Shared CRM repository |
| `src/platformRouter.js` | Authenticated owner-facing overview and Revenue Engine APIs. | Existing dashboard session and CSRF contract |
| `src/paymentWebhooks.js` | Verify and idempotently store MTN/Orange callbacks without guessing settlement semantics. | Shared payment/event repositories |

## Usage bridges

Inbound WhatsApp messages are normalized into platform identities and attributed to the owner workspace during the transitional single-tenant phase. Completed AI responses and successful Anime downloads are also metered. These bridges deliberately do not grant contacts tenant membership; they provide the usage evidence needed before multi-tenant routing is enabled.

Business Autopilot is approval-first. It can qualify leads and recommend next actions immediately, but outbound follow-ups remain proposals unless a user explicitly approves them. Even approved follow-ups remain non-sending while `ARIA_AUTOPILOT_LIVE=false`.

## Security boundary

The existing dashboard password/session remains the owner entrypoint during the migration. Platform mutations are protected by the dashboard CSRF token. The Android Companion bridge is disabled unless `COMPANION_API_KEY` is explicitly configured and uses a separate key from GitHub, AI providers, and session encryption.

Payment providers are not live by default. `ARIA_LIVE_PAYMENTS=false` is the safe default, and non-manual payment intents cannot transition to a successful state while live payments are disabled. Provider adapters must be added only after their official API, callback, signature, sandbox, and merchant onboarding requirements are verified.

## API surface

The existing Express application now exposes:

| Endpoint | Purpose |
|---|---|
| `GET /healthz/live` | Process liveness; does not require media tooling. |
| `GET /healthz` | Readiness; verifies `yt-dlp`, `ffmpeg`, and `ffprobe` and returns HTTP 503 when media is not ready. |
| `GET /healthz?refresh=1` | Re-runs the runtime check instead of relying on cached preflight state. |
| `POST /api/companion/chat` | Android Companion chat; requires `COMPANION_API_KEY`. |
| `GET /api/platform/overview` | Authenticated tenant, plan, usage, event, payment-mode, and Revenue Engine summary. |
| `GET /api/platform/plans` | Authenticated plan catalog. |
| `GET /api/platform/business/:type` | Authenticated tenant-scoped business records. |
| `POST/PATCH /api/platform/...` | Authenticated, CSRF-protected Revenue Engine mutations. |
| `POST /webhooks/payments/mtn` | Signature-verified, idempotent MTN callback ingestion. |
| `POST /webhooks/payments/orange` | Signature-verified, idempotent Orange callback ingestion. |

## Migration rule

Existing product modules must not write platform data directly. New integrations should resolve a platform context, check a capability, perform a tenant-scoped operation, publish a domain event, and record usage where applicable. Existing JSON stores remain in place until repository adapters and migration checks prove that a durable database can take over without loss.

The dashboard now exposes a first-class Business OS pane with plan, usage, customer, lead, pipeline, revenue, and attention-queue visibility. Clear private WhatsApp buying intent is observed conservatively; it creates or updates a lead and conversation but never sends an outbound sales message. Payment callbacks are accepted only with a configured provider secret, and duplicate event IDs are acknowledged without replaying side effects.

The next infrastructure step is to replace the transitional repositories with PostgreSQL-backed repositories, add a shared job/event delivery mechanism, and keep the current JSON adapters for rollback and local development until the production migration is complete.
