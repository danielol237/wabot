# ARIA Upgrade Guide

## What changed

ARIA now treats provider availability, outbound delivery, tool execution, memory, and capability claims as runtime concerns rather than static promises. Normal chat tries every configured route, records successful and failed providers, and temporarily backs off a failing keyed route while other providers remain available. A startup health check records an aggregate provider status without writing credentials to disk.

Every outbound text reply is sanitized at the final WhatsApp boundary. Internal `<think>` and `<analysis>` blocks are removed, ordinary chat is sent as one complete message, and long messages are split without artificial pauses. Natural self-mentions use WhatsApp metadata rather than visible `@number` text.

ARIA’s event memory stores bounded operational and conversation events with correlation identifiers and secret-shaped metadata redaction. It stores summaries and flags such as `inbound`, `outbound`, `provider`, `intent`, `selfMention`, and `sandboxed`, not raw media or API credentials. The dashboard exposes the latest health snapshot and recent reliability metrics.

## How to use the capabilities

| Request in WhatsApp | What ARIA does |
|---|---|
| `ARIA, build a full restaurant website and host through Vercel` | Runs the complete planner, generator, reviewer, quality gate, build verification, browser smoke check, packaging, and preview deployment flow. It reports each stage immediately. Production promotion remains explicit. |
| `ARIA, build me a dashboard` | Builds a complete app through the same quality-controlled flow without requiring a prefix. |
| `ARIA, what can you do?` | Returns a capability report grounded in configured credentials, live provider health, and available runtimes. |
| `ARIA, what can you do that Axon can’t?` | Returns verified practical differences without pretending to know another assistant’s private implementation. |
| Send a sticker alone | ARIA gives a short conversational reaction rather than a visual essay. |
| `What exactly is in that sticker?` | ARIA switches to detailed visual analysis, including legible text and uncertainty boundaries. |
| `How can you read this?` | ARIA explains that WhatsApp supplies media data and a vision model interprets pixels and readable text. |
| `ARIA, hidetag dinner starts at 8` | In a group where ARIA has admin rights, ARIA sends hidden participant mentions without displaying traditional `@` text. |
| `Where’s my ARIA?` | ARIA can attach a genuine hidden self-mention to the natural reply. |
| `ARIA, search the latest news about …` | Uses the configured search chain with bounded timeout/retry behavior and falls through when a search provider fails. |
| `ARIA, run this JavaScript` | Uses the Docker-isolated code runner when available. Untrusted code is blocked if Docker is unavailable; host execution requires an explicit trusted opt-in. |
| `ARIA, remind me tomorrow at 9` | Uses the existing reminder scheduler. Scheduled and background tasks may wait by design; ordinary chat replies never do. |

## Required deployment configuration

The coding route uses the dedicated configured coding provider. Visual replies need at least one visual provider. Search, Vercel, voice, downloads, and scheduled delivery each depend on their corresponding credential or runtime.

| Feature | Configuration or runtime prerequisite |
|---|---|
| Normal AI fallback | At least one configured chat provider; multiple providers improve resilience. |
| Coding and website generation | The dedicated coding-provider credential and model configuration documented in `ARIA_ENGINEERING.md`. |
| Sticker and image analysis | `ZHIPU_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY`. |
| Live web search | `TAVILY_API_KEY` or `BRAVE_API_KEY`; scraping remains a less reliable last resort. |
| Vercel preview deployment | `VERCEL_TOKEN`. Production promotion is intentionally explicit. |
| Download workflows | A working `yt-dlp` runtime visible to `mediaRuntime`. |
| Sandboxed code execution | Docker on the host. Without Docker, untrusted execution is blocked. |
| Voice replies | Voice provider credentials and the configured voice runtime. |

## Operational checks

Ask `ARIA, what can you do?` for a user-facing readiness summary. Operators can inspect the dashboard’s live status and provider-health section for the last probe, healthy routes, backoff state, latency, and recent failures. Event summaries are available through the existing diagnostics surfaces without exposing keys.

If ARIA reports that a provider route is temporarily unavailable, the correct first action is to resend the request after the route’s short backoff window or configure another supported provider. A provider key being present is not proof that the key is valid, funded, authorized for the selected model, or reachable from the deployment environment.
