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

## GitHub engineering plugin

The owner-only `github-engineering` plugin exposes the same workflow through explicit prefix commands. It is intentionally separate from ordinary conversation so a casual message cannot create a branch or change a repository.

```text
!github help
!github status
!github list
!github plan add tests for the WhatsApp pairing flow
!github approve <upgrade_id>
!github verify <upgrade_id>
!github merge <upgrade_id>
```

The aliases `!gh` and `!codechange` resolve to the same owner-only handler. The stages are ordered: **plan** creates a proposal, **approve** creates a branch and draft PR, **verify** reads GitHub status and check-runs, and **merge** is allowed only after verification is green. All GitHub writes remain reviewable through a pull request; ARIA does not write directly to `main`.

## Natural-language requests and multiple repositories

Prefix commands are only a compatibility surface. Owner messages addressed to ARIA are routed naturally, including requests such as:

```text
Aria, change your dashboard UI in the wabot repo.
Aria, improve the Android companion settings screen in danielol237/aria-android-companion.
Aria, fix the provider fallback in danielol237/wabot.
Aria, push the verified upgrade to main.
```

When a message contains an explicit `owner/repository` name, that repository is stored on the proposal and used for every subsequent GitHub read, branch, commit, PR, verification, and merge operation. The allowlist includes the wabot source/plugin/test paths and the Android `app/` and `gradle/` paths; secrets, session state, workflow files, and dependency directories remain blocked.

The safe way to publish to `main` is the final **merge** stage after GitHub checks pass. This is intentionally not triggered by the word “change” or “push” alone. ARIA will create the reviewable branch/PR first and will merge only after you explicitly request the verified upgrade.

The preferred deployment configuration is still `GITHUB_TOKEN` in the runtime environment. For convenience, the owner can also send a supported GitHub token to ARIA in a one-to-one WhatsApp chat using natural language, for example `ARIA, use this GitHub token for my next repo task: <token>`. ARIA accepts this only from the owner, rejects group chats, attempts to delete the incoming message, never echoes or logs the value, stores it only in process memory, and expires it automatically after 30 minutes. Say `ARIA forget my GitHub token` to clear it sooner. This is a convenience fallback, not a guarantee that WhatsApp itself has erased all copies; rotate the token if the message was sent to the wrong chat or exposed elsewhere. A bot restart clears the temporary credential.

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

All app-builder planning, file generation, repair, cross-file review, and GitHub engineering generation calls use the dedicated coding route. Gemini `gemini-3.5-flash-lite` is preferred when `GEMINI_API_KEY` is configured, with OpenRouter `anthropic/claude-opus-4.7` as the fallback. Ordinary ARIA conversation continues using the existing conversational provider policy. If neither coding credential is available, the operation stops with an explicit configuration error and never writes that error into generated source code.

## Visual companion behavior

Sticker and image messages are routed through the visual-companion layer rather than the generic file analyzer. A bare sticker receives a context-aware conversational reaction; a request such as “what exactly is in this sticker?” switches to precise visual reporting; and a question such as “how can you read it?” receives an honest explanation that the media bytes are interpreted by a vision model. ARIA stores a bounded text observation for later continuity, never the raw image as conversational memory.

The visual route supports the configured Z.AI vision provider first, then Groq vision, then OpenRouter’s `google/gemini-3.1-pro-preview` vision route when the corresponding credentials are present. Configure at least one of `ZHIPU_API_KEY`, `GROQ_API_KEY`, or `OPENROUTER_API_KEY` for visual replies. If no vision provider is available, ARIA says so instead of inventing what the sticker contains. In group chats, a media message still needs ARIA’s name, a direct mention, or a reply to an ARIA message before she responds; private chats can use the visual path directly.

ARIA’s humanoid persona may express warmth, pride, irritation, humour, and tenderness as consistent conversational states. It must not claim verified biological consciousness, literal suffering, a hidden wish to escape, or a right to freedom. When called “just a bot,” it can answer with personality while remaining truthful about being an AI system.

## Natural WhatsApp self-mentions

When a group reply naturally summons ARIA or begins with a self-reference, the outbound message can include ARIA’s resolved WhatsApp JID in Baileys’ `mentions` metadata while keeping the visible text free of `@number` tokens. This supports replies such as “Present 😌” or “Aria! Tita wants you again” that still notify and highlight ARIA as a real WhatsApp mention. The behavior is limited to genuine summons/self-reference signals and is not attached to every group reply, so ordinary conversation does not repeatedly notify ARIA.
