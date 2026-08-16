# BlazeZone reference download findings

Reference repository: https://github.com/Randyblazedev/Blazezone

The reference implementation exposes `/api/stream` and `/api/download` endpoints. Its stream resolver follows third-party embed pages and tokenized media hosts, including `vidsrc.me`, `cloudorchestranova.com`, and `peregrinepalaver.space`; the player then points an HLS.js video element at the resolved URL and creates a download link to `/api/download?url=...`. The backend download endpoint proxies the provided URL with a hard-coded referer and streams it as `video/mp4`.

The reference also contains fallback embeds for third-party anime/movie services and token/proxy logic. This is not an acceptable implementation to copy into ARIA Anime because it does not establish that the operator owns or is authorized to redistribute the media, and it would reproduce third-party resolver/bypass behavior.

Safe adaptation made in the user repository: add a direct download path only when the canonical resolver returns a validated candidate whose provider is exactly `authorized` and whose media is a direct MP4 rather than HLS. The safe route reuses the existing signed media token and outbound-host validation, forwards Range requests, preserves upstream content headers, sets Content-Disposition, and rejects unverified providers and HLS sources. Existing server-side job handling remains the fallback for authorized sources that require preparation.

The user repository already has an `ARIA_ANIME_AUTHORIZED_SOURCES_JSON` manifest resolver in `src/tools/sourceResolver.js`, quality selection, validation, signed media tokens in `src/utils/mediaAccess.js`, and public `/anime/watch/:id`, `/anime/dl/:id`, `/anime/file/:id`, and `/anime/proxy` routes in `src/animeSite.js`.
