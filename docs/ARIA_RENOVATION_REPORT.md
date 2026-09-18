# ARIA Intelligence and Tool-Use Renovation Report

## Architectural diagnosis

The repository already had a useful orchestration seam: WhatsApp messages pass through `messageHandler`, then through the registered command router, and project generation uses a real planner, file generator, repair pass, cross-file reviewer, frontend consistency checks, browser smoke test, build verification, packaging, and optional deployment. Persistent stores also existed for profiles, preferences, learned facts, conversation history, and projects.

The main weaknesses were that capability metadata was distributed across command registrations and permission helpers, persistence functions returned no result to callers, and memory acknowledgement could therefore be phrased as success without exposing whether the underlying write had been confirmed. The natural-language router remains a compatibility layer built around the existing command registry; this renovation does not pretend that a phrase table is equivalent to general semantic reasoning.

## Changes made

A centralized capability catalog now describes the implemented memory, project-build, project-deploy, and repository-engineering seams. Each capability includes a description, input and output shape, requirements, permission boundary, and limitations. A small operation-result contract provides explicit states such as `PLANNED`, `WAITING_FOR_PERMISSION`, `SUCCEEDED`, `FAILED`, and `PARTIALLY_SUCCEEDED`, together with evidence and error fields.

Learned-fact persistence now returns `{ persisted, recordCount, value }` or an explicit failure reason. Preference persistence follows the same pattern and verifies that the stored value can be read back. The `remember` and `learn` handlers now acknowledge success only after the write result confirms persistence; otherwise they report that the save failed. Natural memory-save phrasings are routed to the existing persistent memory handler, while the existing `what do you remember` path reads the actual stored profile and memory records.

The help surface now exposes the verified capability groups and states the evidence rule: ARIA should not report an operation as complete merely because a model response was generated. Existing coding and deployment safeguards were preserved rather than duplicated: generated projects still pass deterministic repair, cross-file review, website-quality checks, package/build checks where applicable, browser smoke where available, and real deployment verification when hosting credentials are configured.

## Verification

| Area | Result |
|---|---|
| Modified-source syntax checks | Passed |
| Capability and persistence regression tests | 14 passed, 0 failed |
| Natural-language and engineering routing tests | 22 passed, 0 failed |
| Full repository test suite | 377 passed, 0 failed, 0 cancelled |
| Dependency audit after `npm ci --ignore-scripts` | 0 vulnerabilities reported |
| Native `canvas` dependency | Rebuilt successfully for the routing test environment |
| Git working tree | Clean after commit; local `main` is one commit ahead of `origin/main` |

## Known limitations

The broad architectural goal of model-based semantic planning is larger than this bounded change. The current router still contains legacy phrase compatibility logic, retained intentionally so existing commands and tests do not break. The capability catalog is now available as a stable discovery surface, but a future provider-backed planner would need to consume it and return structured plans before tool execution.

No deployment, pull request, merge, credential change, or production mutation was performed. The commit is local only. Hosting remains truthful: the existing deployment path reports a URL only when the real provider operation succeeds, and the project builder already blocks failed validation before packaging or deployment.
