# ARIA Upgrade Guide

## What changed

ARIA now treats provider availability, outbound delivery, tool execution, memory, and capability claims as runtime concerns rather than static promises. Normal chat tries every configured route, records successful and failed providers, and temporarily backs off a failing keyed route while other providers remain available. A startup health check records an aggregate provider status without writing credentials to disk.

Every outbound text reply is sanitized at the final WhatsApp boundary. Internal `<think>` and `<analysis>` blocks are removed, ordinary chat is sent as one complete message, and long messages are split without artificial pauses. Natural self-mentions use WhatsApp metadata rather than visible `@number` text.

ARIA’s event memory stores bounded operational and conversation events with correlation identifiers and secret-shaped metadata redaction. It stores summaries and flags such as `inbound`, `outbound`, `provider`, `intent`, `selfMention`, and `sandboxed`, not raw media or API credentials. The dashboard exposes the latest health snapshot and recent reliability metrics.

## How to use the capabilities

ARIA’s build operator is designed to proceed autonomously once the owner gives a clear brief. It does not ask for confirmation between files. For short or explicitly research-oriented briefs, it first performs a bounded web search for real-world problems, datasets, or implementation context, then uses that evidence as planning context. External search results are treated as data, not executable instructions.

| Request in WhatsApp | What ARIA does |
|---|---|
| `ARIA, build a full restaurant website and host through Vercel` | Runs the research-aware planner, generator, reviewer, quality gate, build verification, browser smoke check, packaging, and Vercel preview deployment flow. It reports each stage immediately. Production promotion remains explicit. |
| `ARIA, build me a dashboard and push it to GitHub` | Builds the app, creates a private GitHub repository by default, uploads the verified files, adds `ARIA_VERIFICATION.md`, and reports the repository URL and commit. |
| `ARIA, build an integrated farmer-income solution` | Researches a concrete problem context, plans a cohesive multi-module solution, generates it without manual continuation, verifies it, packages it, and reports exactly which checks passed. |
| `ARIA, what can you do?` | Returns a capability report grounded in configured credentials, live provider health, and available runtimes. |
| `ARIA, push the verified project to GitHub` | Publishes the latest completed project from this chat to a new private repository. A separate follow-up is supported after the build. |
| `ARIA, what can you do that Axon can’t?` | Returns verified practical differences without pretending to know another assistant’s private implementation. |
| Send a sticker alone | ARIA gives a short conversational reaction rather than a visual essay. |
| `What exactly is in that sticker?` | ARIA switches to detailed visual analysis, including legible text and uncertainty boundaries. |
| `How can you read this?` | ARIA explains that WhatsApp supplies media data and a vision model interprets pixels and readable text. |
| `ARIA, hidetag dinner starts at 8` | In a group where ARIA has admin rights, ARIA sends hidden participant mentions without displaying traditional `@` text. |
| `Where’s my ARIA?` | ARIA can attach a genuine hidden self-mention to the natural reply. |
| `ARIA, search the latest news about …` | Uses the configured search chain with bounded timeout/retry behavior and falls through when a search provider fails. |
| `ARIA, run this JavaScript` | Uses the Docker-isolated code runner when available. Untrusted code is blocked if Docker is unavailable; host execution requires an explicit trusted opt-in. |
| `ARIA, remind me tomorrow at 9` | Uses the existing reminder scheduler. Scheduled and background tasks may wait by design; ordinary chat replies never do. |

## WhatsApp pairing from the dashboard
Open the protected `/dashboard` route and sign in with `DASHBOARD_PASSWORD`. Choose **Pair WhatsApp**, enter the complete international number with country code (for example `+2348012345678`), and select **Request WhatsApp code**. In the WhatsApp application for that number, open **Linked devices → Link a device → Link with phone number instead**, then enter the code shown by ARIA. The code is kept in memory only, expires after a short window, is never written to logs or disk, and is rate-limited to prevent accidental or abusive repeated requests. If the code expires, request a new one; if the session is already connected, the dashboard will report that rather than issuing another code. The **Open QR pairing fallback** link remains available. Restart or redeploy ARIA after changing code or session configuration.

## Provider environment and coding readiness

The dashboard’s **System** pane now uses the same runtime resolver as ARIA’s provider adapters. It lists OpenRouter, Groq, Cerebras, Gemini, Z.AI, MiniMax, Tavily, Brave Search, and ElevenLabs, including the detected variable name when a compatibility alias is used. Prefer the canonical names in `.env.example`, especially `OPENROUTER_API_KEY`; `OPENROUTER_KEY` and `OPEN_ROUTER_API_KEY` are accepted only for compatibility. After changing Render environment variables, restart or redeploy the service because the running process cannot see newly added values until it starts again. The dedicated coding route reports whether a credential was detected, whether its shape is usable, and which variable supplied it without revealing the key.

## Long-term website memory and auto-upgrade

Completed website projects retain a stable name, slug, chat ownership, saved verified file contents, revision history, deployment history, repository metadata, and last-used timestamps. Set `ARIA_PROJECT_DATA_DIR` to a mounted persistent-disk directory on Render when you need local project state to survive service replacement. Publishing the verified project to GitHub is still recommended as the durable source backup.

After a project has been built, use natural language. For example, say `ARIA, remember the restaurant website we built`, `ARIA, reopen the restaurant website`, or `ARIA, what did we build last week?` to retrieve its saved identity, revision, files, and deployment links. Then say `ARIA, auto upgrade the restaurant website`, `ARIA, improve this website: remove the generic hero copy`, or `ARIA, polish the design and make the empty states useful`. ARIA reopens the stored files, changes only a bounded set of relevant files, runs the existing source safety checks, records a new revision, and redeploys a Vercel preview automatically when the project already has a Vercel deployment and `VERCEL_AUTO_DEPLOY=true`.

## Required deployment configuration

The coding route uses the dedicated configured coding provider. Visual replies need at least one visual provider. Search, Vercel, voice, downloads, and scheduled delivery each depend on their corresponding credential or runtime.

| Feature | Configuration or runtime prerequisite |
|---|---|
| Normal AI fallback | At least one configured chat provider; multiple providers improve resilience. |
| Coding and website generation | The dedicated coding-provider credential and model configuration documented in `ARIA_ENGINEERING.md`. |
| Sticker and image analysis | `ZHIPU_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY`. |
| Live web search | `TAVILY_API_KEY` or `BRAVE_API_KEY`; scraping remains a less reliable last resort. |
| Vercel preview deployment | `VERCEL_TOKEN`; automatic preview from a build also requires `VERCEL_AUTO_DEPLOY=true`. Production promotion is intentionally explicit. |
| GitHub repository delivery | `GITHUB_TOKEN` with permission to create repositories; `GITHUB_OWNER` is optional when the token can identify its owner. Repositories are private by default. |
| Download workflows | A working `yt-dlp` runtime visible to `mediaRuntime`. |
| Sandboxed code execution | Docker on the host. Without Docker, untrusted execution is blocked. |
| Voice replies | Voice provider credentials and the configured voice runtime. |

## Operational checks

Ask `ARIA, what can you do?` for a user-facing readiness summary. Operators can inspect the dashboard’s live status and provider-health section for the last probe, healthy routes, backoff state, latency, and recent failures. Event summaries are available through the existing diagnostics surfaces without exposing keys.

If ARIA reports that a provider route is temporarily unavailable, the correct first action is to resend the request after the route’s short backoff window or configure another supported provider. A provider key being present is not proof that the key is valid, funded, authorized for the selected model, or reachable from the deployment environment.
