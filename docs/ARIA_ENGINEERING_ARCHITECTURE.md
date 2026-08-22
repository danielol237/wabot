# ARIA Engineering System Architecture

## Objective

Turn Wabot’s existing project builder, self-awareness, approval-aware execution, GitHub integration, and Vercel deployment modules into one owner-controlled engineering system. A natural-language request should become a bounded plan, an inspectable diff, a verified build, and a reversible release—not an unreviewed mutation of the live bot.

## Approach comparison

| Approach | Tradeoffs | Cost | Setup Complexity |
|---|---|---:|---:|
| Direct write to `main` and immediate production deploy | Fastest, but one bad model output or prompt can break the bot, expose secrets, or publish unwanted code. Rollback is harder and there is no review checkpoint. | Lowest API overhead | Low initially; high recovery cost |
| Owner-approved branch + pull request + verified Vercel preview/production release | Slightly slower because ARIA pauses for approval, but every change has a branch, diff, validation evidence, audit record, and a clear rollback point. | GitHub/Vercel API usage; no extra service required | Moderate |
| Local-only generated ZIP with manual copy/paste | Safest from remote mutation, but it does not meet the goal of ARIA editing GitHub or deploying projects directly. | Lowest | Moderate manual work |

## Selected workflow

Use the owner-approved branch and pull-request workflow. ARIA may read repository metadata and draft a plan automatically. It may create a short-lived branch and commit only bounded files after the owner explicitly confirms the proposed operation. It must never push directly to `main`, merge its own pull request, rotate secrets, change Render environment variables, or deploy production without a separate owner approval.

The intended conversational flow is:

```text
ARIA inspect your installed modules
ARIA propose an upgrade for <goal>
ARIA show the plan and affected files
ARIA prepare the upgrade
ARIA verify the upgrade
ARIA open a GitHub PR
ARIA deploy the verified project to Vercel
```

The first five operations can produce artifacts and evidence. Branch creation, file writes, pull-request creation, production deployment, and merging are consequential operations and require owner authorization. A failed build blocks release and produces a repair proposal; it does not silently retry forever.

## Credential rules

The runtime reads credentials only from Render environment variables. The repository must never contain values of `GITHUB_TOKEN`, `SESSION_GITHUB_TOKEN`, `VERCEL_TOKEN`, SSH private keys, Supabase service-role keys, or WhatsApp session secrets. SSH is not needed for the server-side workflow; the GitHub REST API is easier to constrain, audit, and use with an allowlisted repository. Any token sent in WhatsApp or terminal history should be rotated.

## Scope boundaries

The implementation may inspect source files, package manifests, test output, and repository metadata. Generated changes are restricted to the configured repository and an isolated temporary workspace. Paths are normalized and traversal is rejected. Shell execution uses argument arrays, fixed working directories, bounded timeouts, sanitized environment variables, and a minimal allowlist of build/test commands. Generated project builds run outside the live bot’s source tree.

Vercel deployment defaults to a preview-style verification step. Production promotion is separate and requires an explicit owner command after the preview URL and health check are reported. The Vercel REST/CLI path must redact tokens from logs and must return deployment ID, URL, build state, and verification evidence.

## References

[1]: https://docs.github.com/en/rest/pulls/pulls "GitHub REST API endpoints for pull requests"
[2]: https://vercel.com/docs/deployments "Vercel deployment methods and REST API workflow"
