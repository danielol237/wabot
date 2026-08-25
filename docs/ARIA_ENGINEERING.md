# ARIA Engineering Workflow

ARIA’s engineering capability is owner-only and is designed to change the repository through reviewable, testable steps. It does not write directly to `main`, expose credentials, or merge an unverified change.

## Self-awareness

Use any of these natural messages:

```text
ARIA, what modules do you have installed?
ARIA, inspect your system
ARIA, show your capabilities
```

Equivalent prefix command:

```text
!engineering status
```

The report is based on the live repository snapshot and runtime configuration. It distinguishes code-supported providers from credentials that are not configured.

## Propose an upgrade

```text
ARIA, propose an upgrade to improve the build system
ARIA, plan an upgrade for safer Vercel deployments
!engineering plan improve the build system
```

ARIA returns a bounded proposal with the objective, allowed files, checks, risks, and rollback. Planning does not write files.

## Generate a GitHub branch and draft PR

After reviewing the proposal:

```text
ARIA approve upgrade <upgrade_id>
```

The controller reads the current `main` files, generates only the allowlisted files, creates a branch, creates a commit, and opens a draft pull request. It never pushes the generated change directly to `main`.

## Verify the PR

```text
ARIA verify upgrade <upgrade_id>
```

ARIA reads the pull request status and commit checks. A proposal is marked verified only when the GitHub commit status is successful and all reported check runs conclude successfully.

## Merge the verified PR

```text
ARIA merge upgrade <upgrade_id>
```

This is blocked unless the proposal is verified green, still targets `main`, and still points to the expected branch. The merge uses GitHub’s squash method and records the resulting commit SHA.

## Build and deploy generated projects

The existing project builder remains available:

```text
ARIA build a React landing page
ARIA build a React landing page and deploy on Vercel
ARIA deploy it
```

The generated project is verified in an isolated temporary directory before Vercel deployment. The Vercel token is read from the runtime environment and is never included in a WhatsApp message or process argument. A production Vercel deployment is an explicit action; a normal build does not publish automatically.

## Safety boundaries

The engineering controller only accepts source and test paths under the configured allowlist. It rejects traversal, environment files, data stores, WhatsApp session directories, GitHub workflow files, and dependency directories. It limits generated files and file size, rejects credential-like output, and records proposals locally for status/recovery.

`GITHUB_TOKEN` or the existing `SESSION_GITHUB_TOKEN` is read only from the runtime environment. `VERCEL_TOKEN` is read only from the runtime environment. SSH private keys are not required by this implementation and must never be pasted into WhatsApp.

## Required remote configuration

No token values belong in source code. The Render runtime must contain the already provisioned GitHub and Vercel credentials for the features to work. The code does not print them, and the engineering inventory reports only whether a credential is present—not its value.

## Operational model

The intended cycle is:

```text
inspect → propose → owner review → approve → branch/PR → CI verification → owner merge → Render deploy
```

If CI fails, ARIA reports the failed state and stops. It does not repeatedly rewrite the same files or merge around failed checks.

## Website builder and Vercel deployment contract

Website builds are accepted only after deterministic quality checks, a project-wide cross-file review, a build verification pass, and a headless Chromium smoke check. The quality gate rejects placeholder copy, missing responsive metadata, missing image alt text, missing local assets, invalid image signatures, missing DOM targets, and unsafe generated paths. The builder uses a disposable Docker runner for `npm install`, build, and start checks; generated dependencies are installed with lifecycle scripts disabled.

Automatic deployment is preview-only. The `!build ... and deploy` flow and `!deploy <project-id>` create a Vercel preview. Production promotion requires an explicit owner command such as `!deploy production <project-id>`. Vercel CLI is pinned, deployment names include a project-specific suffix, readiness is polled before success is reported, and API fallback uploads are bounded and reject symlinks. Set `ARIA_SKIP_BROWSER_SMOKE=true` only for controlled environments that cannot provide Chromium; doing so weakens the release gate and should not be used for public production builds.

## Dedicated coding model

All app-builder planning, file generation, repair, and cross-file review calls use one coding route: OpenRouter with the fixed model `anthropic/claude-opus-4.7`. Ordinary ARIA conversation continues using the existing conversational provider policy. The coding route does not silently fall through to a different chat model. If `OPENROUTER_API_KEY` is absent or the selected coding route fails, the build stops with an explicit configuration/provider error and never writes that error into a generated source file.
