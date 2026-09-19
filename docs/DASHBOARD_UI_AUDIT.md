# ARIA Dashboard UI Audit and Renovation Notes

**Repository:** `danielol237/wabot`  
**Date:** 19 September 2026

## Current architecture

The dashboard is a server-rendered Express interface concentrated in `src/dashboard.js`. It provides authenticated owner access, persisted hashed sessions, CSRF protection for state-changing requests, a responsive sidebar/mobile navigation shell, pane-based navigation, live JSON refresh for selected telemetry, WhatsApp pairing, Atlas workspaces, provider/source health, missions, memory, media, academy, incidents, logs, and system information. `src/tools/dashboardTelemetry.js` supplies the live and historical data layer.

This architecture is functional and security-conscious, but `dashboard.js` remains a very large mixed rendering-and-client-script module. Its pane model is a deliberate single-page shell, while Atlas is a separate route. A future split should preserve this contract rather than replace the server-rendered approach without evidence.

## Strengths

The interface already has a distinct ARIA mark, a calm blue/purple visual language, light and dark themes, responsive breakpoints, mobile bottom navigation, CSRF-protected actions, focus-visible styles, live telemetry refresh, and real backend-backed areas such as WhatsApp pairing and health checks. The home view has a useful “start here” section and gives direct access to Atlas, pairing, the learner portal, and anime functionality. The dashboard does not need a generic SaaS rewrite.

The telemetry layer also avoids several common AI-dashboard problems. Brain reliability is represented as unavailable when there is no AI traffic rather than as a fabricated percentage, and the current implementation has real event recording for messages, commands, AI activity, and errors.

## Problems found

The primary information architecture was too operator-oriented. “Business OS,” “System brain,” “Learners,” “Missions,” “Integrations,” and “Admin” exposed internal or product-development language before user value. Navigation also used clickable `div` elements without keyboard semantics, repeated numeric markers, and a large number of sections visible at once. The mobile navigation was appropriately reduced to five priorities, but desktop naming and hierarchy did not match it.

The shell displayed “Online” even when the WhatsApp connection was not ready. The home activity panel contained static guidance cards rather than actual recent events, which could make the dashboard look active without representing what ARIA had done. The activity and system cards were useful, but the status distinction between process availability, provider configuration, and WhatsApp connectivity was not explicit enough.

The design system is coherent but has several competing geometry values: 7px, 8px, 10px, 13px, 14px, 16px, and 20px radii appear across otherwise similar controls. This is not an emergency issue, but it is a good target for a later token consolidation pass. The mobile CSS has duplicate breakpoint blocks and should eventually be consolidated to reduce maintenance risk.

## Implemented in this pass

The shared shell now receives the actual WhatsApp readiness state and displays `WhatsApp Connected`, `WhatsApp Not connected`, or `Status unavailable` instead of a generic online claim. Status dots use distinct green, amber, and muted states.

Navigation labels were moved toward user-facing language: Workspace, Connections, WhatsApp, Insights, ARIA, Learning, Tasks, and Settings. Pane headings were updated to match. Clickable navigation panes now have button semantics, keyboard activation for Enter and Space, and `aria-current` updates.

The activity panel now reads actual telemetry events through `recentActivity()`. It shows event type, detail, timestamp, and success/failure state. When no events exist it displays an honest empty state instead of static activity claims.

The dashboard now honors `prefers-reduced-motion`, disabling decorative transitions and hover movement for users who request reduced motion.

## Recommended next phases

The next safe phase is a mechanical component extraction from `dashboard.js`: shared shell, tokens, navigation, home pane, health pane, and pairing pane should become separately testable render modules. This should be done without changing routes or data contracts.

After extraction, add browser-level checks for desktop and mobile widths, keyboard traversal, focus visibility, pane switching, pairing form errors, loading states, and real health-status transitions. The dashboard should use actual event streams for the Activity pane rather than only rebuilding HTML on full page loads.

The mobile experience should then be reviewed at approximately 360px, 390px, 768px, and desktop widths. The current layout has no obvious overflow in the audited desktop rendering, but the large navigation vocabulary and the paired grid/card rules justify a dedicated mobile pass.

Large areas such as Atlas, downloads, and academy should not be promoted into primary navigation unless their backend-supported user tasks are clear. Conversely, the existing working routes should remain available through direct links and progressive disclosure.
