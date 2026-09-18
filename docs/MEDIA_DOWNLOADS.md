
## Natural social-media video downloads

ARIA accepts public video URLs from social platforms supported by the installed `yt-dlp` extractor set. Users can send a link in a private chat or group and say “download this”, “save this reel”, “fetch this video”, or “send me the video”. The router extracts the URL from the surrounding sentence, validates that it is an HTTPS public destination, downloads one video up to 50 MB, and sends it back as an MP4 when WhatsApp accepts the media.

ARIA does not bypass private accounts, login walls, DRM, age gates, or host restrictions. A failed extractor, unavailable media runtime, expired link, or oversized result produces a safe explanation instead of exposing command output or server paths. `!yt`, `!tiktok`, and `!ig` remain compatibility aliases and use the same public-host validation.
