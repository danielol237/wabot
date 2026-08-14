# Dashboard Redesign Review

## Initial visual audit — 2026-08-14

The existing dashboard login screen is technically clean but visually generic: a centered white card, violet gradient logo/button, broad empty canvas, and small typography. It does not establish a clear operations-product identity. The global dashboard stylesheet reveals the same pattern across authenticated views: an emoji-heavy navigation system, purple-gradient brand treatment, many identically rounded cards, mixed ad hoc inline styles, overly dense desktop navigation, and a mobile transformation that compresses the full sidebar into a wrapped horizontal strip.

The redesign will use a restrained professional operations visual system instead: warm near-black/navy foundations, one deliberate blue signal color, semantic status colors, clear typographic scale, a fixed desktop rail, a usable mobile bottom navigation, hierarchy-led operational surfaces, and reduced decorative emoji/gradient usage. Atlas will become the primary project cockpit rather than a dense nested card collection.

## Functional failures reported by owner

1. The live Render app is still on merged Atlas V2. Atlas V3 Sentinel is in PR #50, whose CI passed, but it is not merged into `main`; therefore the live bot cannot route “show Sentinel” yet and falls through to general chat.
2. Gemini currently appends the “This got cut off because it’s a big build” notice when its finish reason is `STOP`, which is a normal successful completion. This causes unwanted continuation notices in ordinary conversation and must be changed to only react to actual token exhaustion.

## Target dashboard system

The replacement layout will use a clear operations-console hierarchy:

| Layer | Design decision | Reason |
|---|---|---|
| Global shell | Fixed dark navigation rail on desktop; compact bottom navigation on mobile; sticky top bar with workspace name, connection state, theme control, and logout | Keeps navigation predictable instead of forcing users to scan a wrapped sidebar |
| Primary page | One strong page title, one operational summary, and one primary action per screen | Removes competing rounded cards and unclear visual priorities |
| Atlas cockpit | North Star header, compact KPI row, next actions, blockers, roadmap progress, Sentinel alerts, and evidence timeline | Makes project state readable within one screen before deep detail |
| Typography | System sans stack, 12/14/16/24/32 scale, higher line-height for descriptions, tabular numbers for metrics | Improves scanning and gives the interface a serious product feel |
| Color | Ink/navy surfaces, slate borders, one blue accent, green/amber/red semantic statuses; no ornamental purple gradients | Makes color communicate state rather than decoration |
| Components | Small radii, 1px borders, restrained shadows, consistent button heights, visible keyboard focus, touch targets at least 44px | Creates consistency and reliable mobile interaction |
| Mobile | Full-width sections, horizontal overflow only for deliberate data tables, bottom nav for primary areas, no tiny desktop sidebar labels | Prevents the current compressed-dashboard feel on Android screens |

Atlas will be the first redesigned surface because it is the project operating system. The rest of the existing dashboard panes inherit the new shell and component tokens without changing their APIs or security controls.

## Refreshed preview checkpoint

The new login surface now renders the ARIA mark as a deliberate text-based `A` badge rather than an empty/abstract gradient shape. The authenticated shell still needs a browser interaction pass, but the server-side dashboard tests confirm the redesigned Atlas markup renders and remains owner-authenticated.

The browser automation preview could render the login screen and accept the password field, but the click action intermittently returned an unavailable screenshot/page state. I will rely on the deterministic dashboard HTTP tests plus source-level responsive verification and keep the preview server isolated; no production browser operation was performed.

## Deterministic layout verification

The authenticated HTML preview is 37,939 bytes and contains the new operator header, `atlas-layout`, `mobile-nav`, `NORTH STAR`, and `Sentinel signals` surfaces. Responsive rules are present at 900px, 820px, and 580px breakpoints, including a five-item mobile navigation grid and safe-area padding for Android/iOS bottom insets. The browser tool became unavailable during the authenticated click step, so visual acceptance is backed by the rendered HTML markers and 118-test repository verification rather than a misleading screenshot claim.
