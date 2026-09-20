# ARIA Coding-System Audit and Upgrade Report

## Conclusion

ARIA’s coding system already had several strong foundations: bounded repository paths, secret-file denial, provider-failure filtering, project planning, generated-project repair, deterministic validation, package verification, browser smoke checks, isolated workspaces, GitHub pull-request delivery, and explicit protection against direct writes to `main`.

The main weakness was orchestration rather than generation quality. The website builder reported progress, but it did not expose a durable task with dependency-aware step states. The repository engineering flow had its own proposal lifecycle, so coding execution was split across two partially independent control models. Capability reporting also mixed static claims with runtime-dependent availability.

This upgrade strengthens the shared build path without replacing the existing coding provider, generator, verifier, project store, permission model, or GitHub workflow.

## Audit findings

### Strengths retained

The existing coding agent constrains file paths, limits generated file counts, rejects provider-error text as source code, repairs common frontend contract problems, validates projects, runs package checks in an isolated workspace, and performs browser verification when a browser is available. The engineering system also requires a reviewable GitHub pull request instead of writing directly to the protected base branch. These controls remain intact.

### Gaps addressed

The build flow previously had no durable task object that represented the relationship between planning, generation, verification, and persistence. A progress message could be emitted, but the system did not expose a stable task identifier or step-level state that a dashboard could query later.

The build flow also needed a stronger failure boundary. A failed generation or verification step must prevent downstream persistence from being reported as completed. This was implemented through dependency-aware action tasks.

Capability reporting previously contained useful runtime checks for providers and selected media tools, but it did not expose one consistent environment inspection result for core tools, connectors, and storage. The new registry probe reports actual command availability and configuration status at inspection time.

## Implemented changes

### Durable action tasks

`src/tools/actionTask.js` introduces a bounded, persisted task model with the states `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`, `SKIPPED`, and `NOT_VERIFIED`. Each task has an identifier, goal, chat scope, timestamps, ordered steps, dependencies, results, errors, and completion state.

A step can run only after its dependencies complete. When a prerequisite fails or cannot be verified, dependent steps are skipped and the final task cannot become successful. Every transition is written to the existing event timeline, so the task system does not create a second telemetry store.

### Project-build integration

The existing `appBuilder` now creates a `project.build` task with four steps:

1. Define the project contract.
2. Generate the connected codebase.
3. Run validation, repair, and runtime checks.
4. Persist the verified project artifact.

Successful build responses now include the task summary. Failed responses include the same task summary, including the exact failed or skipped step. Existing project state, revision history, cleanup, quality gates, packaging, and deployment behavior remain in place.

### Dashboard access

The authenticated dashboard now exposes:

```text
GET /dashboard/api/action-tasks
```

The endpoint returns actual persisted task states. It does not synthesize progress or infer success from a chat message.

### Environment and connector awareness

`src/utils/capabilityCatalog.js` now provides `inspectEnvironment()`. It probes Git, FFmpeg, yt-dlp, and Chromium using executable lookup rather than assuming that a package entry means the tool is usable. It also reports connector configuration for GitHub, Vercel, Supabase, and the Android companion, along with filesystem, project-memory, and database availability.

GitHub inspection includes ARIA’s encrypted per-user credential vault as well as the process environment. Capability-profile responses now include the live tool results, including the static verification fallback when Chromium is unavailable.

## Truthful-result contract

The upgraded build path follows this rule:

> A downstream action cannot be reported as completed unless its prerequisites completed and its own result was verified.

For example, if generation fails, verification and persistence become skipped. If verification returns an unverified result, persistence does not run and the task ends as `NOT_VERIFIED`. If every step completes, the task ends as `COMPLETED` and the build response includes the step evidence.

This does not claim that every external platform action is automatically safe. Deployment, GitHub merging, account changes, messaging, and public publication continue to use their existing permission and explicit-action boundaries.

## Remaining limits

The existing GitHub proposal workflow remains a separate, deliberate review path. It already protects the base branch, creates a draft pull request, verifies GitHub checks, and blocks merging until verification succeeds. It has not been silently replaced with automatic code execution.

The current action-task persistence is file-backed and bounded for the single-instance Wabot deployment model. A multi-instance deployment would need shared storage such as a database or Redis so that dashboard reads and worker writes observe the same task state.

The current implementation improves the build path first. A later phase can apply the same task contract to GitHub proposal generation, deployment workflows, and media action chains without introducing another orchestration framework.

The coding provider remains environment-dependent. If no provider is configured, ARIA can use the existing deterministic fallback for supported website templates, but it cannot honestly claim arbitrary application generation from a missing model provider.

## Verification

Focused coding, engineering, capability, and website tests passed **21/21**. The complete Wabot suite passed **396/396**, with zero failures, cancellations, or unexpected skips. Syntax checks and `git diff --check` also passed.

The suite includes regression coverage for successful dependent tasks, failed-prerequisite skipping, live capability inspection, existing engineering safeguards, website quality gates, and Chromium-free static smoke verification.

## Files changed

- `src/tools/actionTask.js` — durable dependency-aware action execution.
- `src/tools/appBuilder.js` — task integration for project builds.
- `src/utils/capabilityCatalog.js` — live tool and connector inspection.
- `src/tools/capabilityProfile.js` — runtime capability reporting.
- `src/dashboard.js` — authenticated action-task API.
- `test/codingExecution.test.js` — task and capability regression tests.

## References

[1]: ../src/tools/actionTask.js "ARIA durable action-task executor"
[2]: ../src/tools/appBuilder.js "ARIA project build orchestration"
[3]: ../src/utils/capabilityCatalog.js "ARIA capability and environment registry"
[4]: ../src/tools/engineeringSystem.js "ARIA GitHub engineering proposal workflow"
[5]: ../src/tools/projectValidator.js "ARIA deterministic project validator"
[6]: ../test/codingExecution.test.js "ARIA coding execution regression tests"
