# ARIA Verified Website Delivery Workflow

ARIA now supports an owner-only website delivery command:

```text
!deliver create a portfolio website for ARIA
```

The aliases `!buildsite` and natural requests such as “ARIA, build a website and give me the link” use the same flow.

The workflow builds the project through the existing app builder, runs its dependency/import/script validation, performs the real build and browser smoke checks, deploys the verified result to a Vercel preview when `VERCEL_TOKEN` is configured, opens the live URL with headless Chromium, captures a screenshot, and sends the result back through WhatsApp. When available, the verified ZIP archive is sent as a document as well.

The workflow intentionally does not report a public link when deployment was not completed. In that case ARIA reports that the project passed local verification but that `VERCEL_TOKEN` is missing or deployment failed.

## Configuration

The deployment runtime needs `VERCEL_TOKEN` for public preview URLs. The browser executable defaults to `chromium` and can be overridden with `ARIA_CHROMIUM_PATH`. The existing Vercel project deployment configuration remains the source of truth for project hosting.

## Examples

```text
!deliver build a dark personal portfolio for Daniel
!build a landing page for my anime project and send me the link
ARIA, create a website for my business and show me what you built
```

The command is owner-only because it can create hosted projects and send generated artifacts externally.
