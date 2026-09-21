# ARIA Coding Agent Redesign

## Executive conclusion

The previous coding system did not fail only because of its WhatsApp response formatting. Its core workflow was too shallow: it asked a model for a file list, asked for all files in one large response, and silently substituted a generic dashboard when generation failed. That made a result appear valid even when it did not represent the user’s request. This redesign changes the execution contract rather than adding another response template.

## Audit findings

The build path was routed through `appBuilder.js` and `codingAgent/index.js`. The planner had no durable product requirement contract, and the generator received only a short request plus a file manifest. The generated-file normalizer accepted any non-empty set of files and did not require every planned file to be returned. Most importantly, provider failure for web projects was converted into a generic hard-coded dashboard with a successful status. The existing static, package, and browser checks could validate that dashboard without proving that it fulfilled the user’s goal.

## Implemented changes

A new requirement-analysis layer now converts a natural-language request into a structured product contract containing product type, audience, features, sections, interactions, stack, sensible defaults, and acceptance criteria. It uses the coding provider when available and deterministic safe defaults when analysis itself is unavailable; it never asks unnecessary design questions before producing a first version.

The contract is now carried through project planning, generation, persistence, and the final user-facing result. The generator prompt explicitly requires a complete product rather than a code sample, domain-specific copy rather than a generic dashboard, working interactions, responsive behavior, accessibility, error and empty states, documentation, and one shared contract across HTML, CSS, JavaScript, and package scripts.

Generated output must now include every file in the plan. Missing planned files are treated as a generation failure and enter the existing repair path. A coding-provider failure is no longer converted into a fake successful website. ARIA reports the actual failure and its provider/runtime cause instead.

Successful build responses now include the inferred product type and a short list of included features without exposing internal JSON, task objects, paths, or repair telemetry.

## Verification

The focused coding and delivery tests passed, including requirement extraction for a barber-shop brief, professional-default behavior for a portfolio request, build-result formatting, delivery truthfulness, generated-project repair, website quality, and natural routing. The complete Wabot suite passed with **406 tests passed, 0 failed**.

## Operational requirement

The coding provider must be configured in the deployed runtime for ARIA to generate new projects. If no provider is available, the system now reports that limitation honestly instead of claiming that a generic fallback is the requested product. Existing verified projects, project persistence, deployment, GitHub delivery, and the prior routing contracts remain in place.
