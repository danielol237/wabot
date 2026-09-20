# ARIA Media and Capability-Platform Upgrade

## Executive summary

ARIA now has a reusable capability execution layer for native media work and future connectors. The implementation prefers local runtimes for image processing, audio/video conversion, speech synthesis, and optional speech recognition. It also exposes actual runtime and connector availability instead of relying on a static or model-generated list.

The complete regression suite passed **400 tests with zero failures** after this upgrade.

## What was already present

ARIA already received WhatsApp media through the Baileys socket, downloaded image/video/audio attachments, converted images and short videos into WhatsApp stickers, used Sharp and FFmpeg for media work, maintained media context, and sent media responses. It also had provider-backed multimodal vision and voice routes.

The audit found that the architecture had two important gaps. First, media processing and external action selection were not represented by one reusable capability executor. Second, the existing “no key” voice and vision descriptions could be misunderstood as fully local multimodal intelligence even though semantic vision still used configured model providers and speech synthesis used network fallbacks when no local synthesizer existed.

## Implemented architecture

### Native media runtime

`src/tools/nativeMedia.js` provides local, verifiable operations:

- Image inspection with format, dimensions, animation, alpha-channel, size, and SHA-256 metadata.
- Image conversion and resizing through Sharp.
- Audio/video transcoding through a local FFmpeg executable.
- Local speech synthesis through `espeak-ng` or `espeak` when installed.
- Runtime probes for Sharp, FFmpeg, FFprobe, Tesseract, and local speech synthesis.

The operations return buffers, checksums, sizes, and explicit success flags. They do not claim semantic understanding that they did not perform.

### Capability executor

`src/tools/capabilityExecutor.js` provides a registry and dependency-aware multi-step executor. Registered native actions currently include image inspection, image conversion, FFmpeg transcoding, local speech synthesis, runtime connector discovery, and injected WhatsApp media delivery.

A plan can now express the intended action chain, for example:

```text
inspect image → convert to WebP → send through WhatsApp
```

Each step receives prior outputs, records evidence, and is blocked when a dependency fails or cannot be verified. The executor uses ARIA’s durable action-task state model rather than inventing completion from a chat response.

### Capability and connector discovery

The capability catalog now includes native media and WhatsApp delivery contracts alongside memory, coding, deployment, and GitHub engineering capabilities. The runtime inspection reports actual availability for Git, FFmpeg, yt-dlp, Chromium, Sharp, FFprobe, Tesseract, and local speech synthesis. It also reports whether GitHub, Vercel, Supabase, and Android companion credentials are configured.

Users can ask questions such as “what connectors do I have?” or “which tools do you have?” and ARIA now responds from the live registry. An unavailable or unconfigured tool is shown as unavailable; it is not presented as a hallucinated capability.

### Voice path

Voice transcription now checks for a local Whisper-compatible executable before the existing Groq and no-key web fallback. Text-to-speech now checks for local `espeak-ng` or `espeak` before MiniMax, ElevenLabs, and FreeTTS. The returned provider label remains explicit.

### Vision path

When a multimodal model provider is configured, ARIA continues to send the decoded media bytes to that provider. When no provider is configured, ARIA performs only local image metadata inspection and tells the user that semantic scene recognition and text reading are unavailable. This is deliberate: local byte decoding and metadata inspection are not the same thing as a local vision model.

## Important answer to the API-free requirement

The runtime can process media locally without an external AI API for deterministic operations such as resizing, converting, compressing, transcoding, hashing, inspecting dimensions, and creating stickers. It can also synthesize speech locally if a system synthesizer is installed.

However, **semantic vision**—recognising characters, understanding a meme, describing a scene, or reading arbitrary text from pixels—requires either a local multimodal model installed in the host or a configured multimodal provider. The current Wabot runtime has the provider route and the native media layer, but it does not contain a local semantic vision model. ARIA now reports that boundary honestly instead of pretending that raw WebP/JPEG decoding alone is vision intelligence.

Likewise, no-key Google Web Speech fallback is still a network speech-recognition route. It is not a private local speech engine. A local Whisper-compatible executable can now take precedence when operators install one.

## Current environment verification

During the audit environment check:

| Component | Result |
|---|---|
| Sharp | Available |
| FFmpeg | Available |
| FFprobe | Available |
| Chromium | Available |
| yt-dlp | Not available in the audit environment |
| Tesseract | Not available in the audit environment |
| Local espeak/espeak-ng | Not available in the audit environment |
| GitHub/Vercel/Supabase/companion credentials | Not configured in the audit environment |

Deployment environments may differ; ARIA discovers the runtime at inspection time rather than assuming these results are universal.

## Tests

Focused media, capability, voice, vision, sticker, routing, and runtime tests passed **34/34**. The complete Wabot suite passed **400/400**, with no failures, cancellations, or unexpected skips. Syntax checks and `git diff --check` passed.

New regression coverage verifies local image inspection and conversion, local runtime reporting, capability discovery, dependency-aware multi-step execution, and truthful failure behavior.

## Files changed

- `src/tools/nativeMedia.js`
- `src/tools/capabilityExecutor.js`
- `src/utils/capabilityCatalog.js`
- `src/tools/capabilityProfile.js`
- `src/tools/visionAI.js`
- `src/tools/voice.js`
- `src/utils/commandRouter.js`
- `test/nativeMediaExecutor.test.js`
- `test/ariaCapabilityTruth.test.js`
