# ARIA redesign and media-provider research

## Z.AI implementation facts

The official Z.AI quick-start documentation states that the platform exposes a standard REST API and OpenAI-compatible calling methods, and lists GLM-Image and CogVideoX-3 among the current model families. The official image-generation reference documents the `glm-image` and `cogview-4-250304` model codes, prompt input, quality selection, image-size constraints, and an end-user identifier field. The current video documentation describes CogVideoX-3 as supporting text, image, and start/end-frame inputs, with video output and improved motion stability. The Vidu Q1 guide describes a separate five-second, 1080P image-to-video and text-to-video option that also supports anime-oriented output.

For ARIA, Z.AI should be isolated to three capabilities: image generation, video generation, and vision/image understanding. The existing `src/tools/ai.js` text-provider chain should remain unchanged. The current `visionAI.js` Groq-only helper is the cleanest vision insertion point, while `deathBattleVideo.js` is the current motion-comic fallback and should gain a provider-backed video path without removing the ffmpeg fallback. The implementation must never expose `ZHIPU_API_KEY` to browser code or include it in logs.

## Google learner signup facts

Google’s official web-server OAuth guidance requires an exact authorized redirect URI, a server-held client secret, a state value that is round-tripped and checked for request-forgery protection, and a server-side authorization-code exchange. Google’s OpenID Connect guidance recommends `openid email` for a basic login request, identifies the stable `sub` claim as the application user identifier, and documents the server flow as state creation, authorization redirect, state confirmation, code exchange, identity extraction, and authentication.

The current learner portal already implements state and a signed cookie, but its callback uses a separate userinfo request and derives the base URL from `BASE_URL` or `RENDER_EXTERNAL_URL`. The repair should make the public origin and redirect URI deterministic, validate the Google identity response more strictly, preserve the stable provider subject as the account key, surface actionable configuration errors, and add tests for redirect URI construction, state/cookie mismatch, missing code, provider failure, and successful callback handling.

## References

[1]: https://docs.z.ai/guides/overview/quick-start "Z.AI Quick Start"
[2]: https://docs.z.ai/api-reference/image/generate-image "Z.AI Generate Image API"
[3]: https://docs.z.ai/guides/video/cogvideox-3 "Z.AI CogVideoX-3 Guide"
[4]: https://docs.z.ai/guides/video/vidu-q1 "Z.AI Vidu Q1 Guide"
[5]: https://developers.google.com/identity/protocols/oauth2/web-server "Google OAuth 2.0 for Web Server Applications"
[6]: https://developers.google.com/identity/openid-connect/openid-connect "Google OpenID Connect"
[7]: https://support.google.com/googleapi/answer/6158849?hl=en "Google OAuth Client ID Setup"

## Professional product-design findings

Material Design, GitHub Primer, and Atlassian Design all treat a product suite as a system rather than a collection of individually decorated pages. Their shared practices are to centralize reusable design tokens for color, typography, spacing, shape, elevation, and component states; keep hierarchy primarily typographic instead of relying on color alone; use rem-based type and unitless line-height for zoom and readability; and make spacing, grids, accessibility, content clarity, and logos explicit foundations.

ARIA’s replacement system will therefore use one tokenized light/dark palette, an editorial sans display face paired with a neutral UI sans, a restrained orchid-coral-teal accent set, 4/8px spacing rhythm, compact but readable cards, left-aligned hierarchy, consistent focus rings, and role-specific surface density. The logo will be a simple feminine orbital-flower/signal symbol with a graceful A-shaped negative space, designed to remain legible at 20px and at app-icon size without relying on generated wordmark text.

## Design references

[8]: https://m3.material.io/foundations/design-tokens "Material Design 3 Design Tokens"
[9]: https://primer.style/ "GitHub Primer Design System"
[10]: https://primer.style/foundations/typography "GitHub Primer Typography"
[11]: https://atlassian.design/foundations "Atlassian Design System Foundations"
