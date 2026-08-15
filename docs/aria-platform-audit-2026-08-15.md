# ARIA Platform Audit — 15 August 2026

## Executive assessment

ARIA is a substantial, feature-rich CommonJS Node.js WhatsApp application, but it is still structurally a single-product bot rather than a commercial platform. The correct transition is incremental: stabilize the current product first, then introduce a platform core beside the existing bot so that identity, tenants, permissions, events, usage, billing, and product modules become explicit domains instead of more isolated utilities.

The current branch is `manus/aria-command-runtime-fix`, two commits ahead of `main`, with pull request #65 open against `main`. Pull request #65 is clean and its CI test job is green, but it has not been merged. Production is therefore still running the merged `main` line rather than the natural-language/LID fixes on the branch.

## Verified baseline

| Area | Verified state | Significance |
|---|---|---|
| Runtime | Node.js `>=22 <23`, CommonJS | Existing architecture can be extended without an ESM migration. |
| Application entrypoint | `src/index.js` starts Express and the Baileys lifecycle at module load | Blind `require()` smoke tests can accidentally start WhatsApp; future tests need an app factory or explicit boot guard. |
| Automated tests | 178 passing, 0 failing, 0 cancelled, 0 todo | Current regression suite is green before new work. |
| JavaScript syntax | All `src/**/*.js` files passed `node --check` | No syntax blocker found. |
| Dependency audit | `npm audit --audit-level=high` reported 0 vulnerabilities | No active high-level dependency vulnerability blocker was reproduced. |
| Media build | `build.sh` completed locally; project-local `yt-dlp`, `yt-dlp-ejs`, `ffmpeg`, and `ffprobe` were available | The committed build recipe is viable locally; the production failure likely reflects deployment/build configuration, stale deployment, or runtime path visibility rather than an inherently invalid script. |
| Live Render root | Redirects to `/anime` | Public product entrypoint is the Anime surface. |
| Live Render dashboard | `/dashboard` returns 401 without credentials | Authentication is active, but the live dashboard cannot be assessed without an authenticated session. |
| Live Render health | `/health`, `/api/health`, and `/api/status` return 404 | There is no small unauthenticated operational health contract suitable for deployment verification. |
| Persistent storage | JSON files under `data/` plus local sessions/temp files | Suitable for a personal bot and tests, not safe as the long-term multi-tenant commercial source of truth. |
| Database/billing | No production PostgreSQL/MySQL/SQLite/Redis, tenant, subscription, invoice, entitlement, or payment domain was found | This is the central commercial architecture gap. |
| Codebase size | 164 source JavaScript files, 38 test files, 19 documents | Refactoring must be staged; a rewrite would create unnecessary regression risk. |
| Largest modules | `dashboard.js` 144 KB; `commandRouter.js` 138 KB; `animeSite.js` 56 KB; `appBuilder.js` 46 KB | Dashboard and routing are monoliths and should be decomposed behind stable interfaces. |

## P0 issues to resolve before commercial work

### Anime media runtime

The public Anime site and dashboard currently expose a user-visible `DEPENDENCY_MISSING` failure stating that `yt-dlp` is not installed. The repository's `build.sh` does install a project-local wrapper and local Python modules, and the same script succeeded in the audit environment. Therefore the next fix must verify the actual Render build command, deploy commit, environment variables, and runtime filesystem rather than adding another blind provider patch.

The runtime resolver currently searches several paths, including the project-local `.render/media/bin`, Render project paths, and the system path. The job manager caches a failed `yt-dlp` preflight result for the process lifetime. That cache is efficient when the dependency is truly missing but makes recovery impossible inside the same process after an operator repairs the runtime. The health surface should expose the resolved command, versions, and a retry/reset mechanism without exposing secrets.

### Production observability

The application has no compact public health endpoint. Deployment verification therefore depends on authenticated pages or indirect behavior. A future `/healthz` endpoint should report process health, build version, media-runtime availability, WhatsApp connection state, queue depth, and dependency status with secrets excluded. A separate authenticated diagnostics endpoint can include detailed provider and job information.

### Dashboard and theme quality

The dashboard is a 144 KB monolith. The repository contains theme logic, but the user screenshots show inconsistent presentation across screen sizes and surfaces. The dashboard needs a stable shell, design tokens, responsive navigation, explicit loading/error/empty states, and one shared theme implementation rather than repeated inline style systems. This work should be performed after the reliability contract is established so visual changes do not hide operational failures.

### Natural-language command release

PR #65 contains the current natural-language routing and LID-aware admin fixes. It is green and clean but not yet merged. Until it reaches `main` and Render redeploys, natural group actions may continue to fall through to generic chat and modern WhatsApp LID identities may fail authority checks in production.

## Platform gap map

| Target domain | Current reality | Planned boundary |
|---|---|---|
| Identity | Owner-centric environment variables, dashboard sessions, WhatsApp identities | Users, identities, authentication providers, session scopes, tenant membership |
| Tenants | No explicit tenant model | Tenant record, settings, lifecycle, limits, data ownership |
| Permissions | Owner/admin checks scattered through modules | Roles plus capability policies enforced at service boundaries |
| Events | JSON event log and provider-specific webhook handling | Versioned domain events, idempotency, delivery/retry metadata |
| Usage | Some telemetry and provider reputation records | Metered AI, media, automation, storage, and message usage |
| Billing | Not implemented as a domain | Plans, subscriptions, invoices, payment intents, entitlements, quotas |
| Business OS | No CRM/revenue domain | Customers, conversations, leads, products, orders, follow-ups, attribution |
| Execution | Missions, schedulers, task poller, autonomous tools | Controlled jobs with approvals, retries, audit, tenant and capability context |
| Storage | Multiple JSON stores and local files | Transitional repository interfaces, then durable database/object storage |
| Products | Assistant, Academy, Atlas, Anime, Developer, media tools | Product modules consuming shared platform contracts |

## Implementation guardrails

The migration will preserve the current bot and add the platform core beside it. No live payment collection will be enabled by default. Payment providers will first be represented by adapters with sandbox/test contracts, signed callback verification, idempotency, and explicit owner approval for any money-moving operation.

Anime will remain a product module with a clear distinction between catalog metadata, authorized playback, and downloadable media. The platform must not claim that a title is downloadable unless a validated source, runtime, and delivery path are available.

Every new domain operation will carry an actor identity, tenant identity, correlation identifier, timestamp, and audit outcome. Existing JSON stores will be wrapped behind repositories before any migration is attempted, allowing tests and current features to continue working while the durable data layer is introduced.

## Immediate execution order

1. Fix and verify the media-runtime deployment contract and add health diagnostics.
2. Merge and deploy the green command-runtime/LID branch.
3. Add a testable application factory and route-level health checks so future audits do not start WhatsApp.
4. Introduce the platform-core interfaces and transitional JSON repositories.
5. Add tenant-aware identity, capability checks, events, audit, usage, and quotas.
6. Build the Business OS and Revenue Engine MVP.
7. Integrate payment adapters in sandbox mode only, then add production configuration gates.
8. Rework the dashboard around the shared platform contracts and verify every product module against tenant isolation.

This is the foundation for evolving ARIA from a powerful bot into a platform without breaking the existing WhatsApp, Anime, Academy, Atlas, and developer systems.

## Audit artifacts

The baseline test log was written to `/tmp/aria-baseline-tests.log`. The local media build log was written to `/tmp/aria-media-build.log`. The live Render HTML probe was written to `/tmp/aria-live-anime.html`.
