
## Natural social-media video downloads

ARIA accepts public video URLs from social platforms supported by the installed `yt-dlp` extractor set. Users can send a link in a private chat or group and say “download this”, “save this reel”, “fetch this video”, or “send me the video”. The router extracts the URL from the surrounding sentence, validates that it is an HTTPS public destination, downloads one video up to 50 MB, and sends it back as an MP4 when WhatsApp accepts the media.

ARIA does not bypass private accounts, login walls, DRM, age gates, or host restrictions. A failed extractor, unavailable media runtime, expired link, or oversized result produces a safe explanation instead of exposing command output or server paths. `!yt`, `!tiktok`, and `!ig` remain compatibility aliases and use the same public-host validation.

The feature is controlled by `MEDIA_DOWNLOAD_ENABLED` and `MEDIA_DOWNLOAD_MAX_MB` (default `1` and `50`; the size is bounded to 1–100 MB). `MEDIA_ALLOWED_HOSTS` can optionally restrict fetching to an operator-selected host allowlist. Public YouTube, TikTok, and Facebook links work when their installed `yt-dlp` extractors can resolve them.
