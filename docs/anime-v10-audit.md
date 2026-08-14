# ARIA Anime V10 Audit

## Observed resolver run

Command: `resolveEpisode("One Piece", 1, { quality: "720" })` with the local resolver and no file download.

The resolver completed without a selected source after approximately 23 seconds. AniList canonical resolution succeeded for `ONE PIECE` with id `21`, but the active source providers produced no candidate:

| Provider | Observed result |
|---|---|
| OmniSave | Search returned results, but episode 1 returned zero downloads and no usable non-VIP URL. |
| Gogoanime | Search returned no results in this environment. |
| Consumet | Timed out at the configured 18-second provider deadline. The underlying fallback logs showed Hianime returning HTTP 522 and Anikai DNS failure. |
| AnimePahe | The legacy `animepahetv.to` session/play structure has migrated and returned no session. |

Because every active provider returned zero candidates, validation never ran and both the public site and WhatsApp queue had no playable/downloadable source to consume. This is a provider reliability failure, not only a UI problem.

## Code-path findings

The dashboard anime browser already carries a selected quality through watch and download routes, with `360`, `480`, `720`, `1080`, and `best` options. The public `/anime` site does not reuse that behavior: its title page exposes a single Download link, its download route enqueues `quality: "best"`, and its watch route resolves without a requested quality. The public page also lacks a persistent download-progress surface, Continue Watching, My List, schedule, and a source/quality summary.

The shared job manager already accepts the quality and applies height-bounded yt-dlp selectors. WhatsApp also parses a trailing quality suffix, but the user experience is a plain queued text response and depends on the same source resolver. The common blocker is therefore the lack of a viable provider candidate plus the public site not exposing the quality-aware job behavior that already exists in the dashboard.

## V10 direction

The next implementation should keep the existing SSRF/media-token and approval/safety boundaries, port the dashboard’s proven quality-aware controls into the public site, add watch/download status surfaces, and improve provider fallback diagnostics. A source should only be presented as playable or downloadable after validation; the UI must say when a requested quality is unavailable rather than claiming a download is ready.


## Follow-up reliability findings

The original `HTTP undefined` download failure was reproduced locally as `Invalid IP address: undefined` inside the pinned DNS lookup path. The root cause was a Node lookup callback that did not honor the `{ all: true }` return contract. The public proxy, dashboard proxy, and shared outbound agent now return either a single address or an address list correctly.

A native request through the corrected path reached the OmniSave media host and returned HTTP 429, proving that the local request-layer error is gone but the upstream CDN can rate-limit or reject the signed URL. Fresh resolver runs continue to show OmniSave alternating between zero usable non-VIP URLs and one direct URL that fails upstream validation; Consumet’s current adapters remain unavailable or timeout (Hianime 522, AnimeKai DNS failure, AnimePahe DNS failure, AnimeUnity 403, KickAssAnime timeout, AnimeSaturn 404, AnimeSama package incompatibility).

The product must therefore report source health honestly and expose retry/quality controls, while the provider layer remains best-effort. A successful download still depends on at least one configured source returning a current, authorized, non-rate-limited media URL.


## Successful resolution checkpoint

After the fixes, a fresh `One Piece` episode 1 request at 720p completed with a validated OmniSave direct MP4 candidate. The candidate advertised 360p, so the 720p request correctly falls back to the highest available source at or below the requested height rather than fabricating a 720p stream. HTTP range probing and yt-dlp extraction passed; remote ffprobe was deferred because this signed CDN does not reliably answer a second seek request, while the job worker still requires the downloaded file to pass local ffprobe before website or WhatsApp delivery.

The resolver completed in approximately 46 seconds in the sandbox. OmniSave was healthy for that run; the Consumet bundle completed with bounded per-adapter failures instead of keeping the process alive indefinitely. This confirms the end-to-end source path is now capable of producing a validated candidate, although upstream availability remains variable.


## Local visual verification

The local desktop preview rendered the new home surface successfully: the orbital ARIA mark is visible in the header, the hero uses a strong featured-title composition, the quick-start panel explains the streaming/download contract, and the trending/updated rails use a clean editorial card grid.

The One Piece title page also rendered correctly. AniList supplied title metadata but not episode metadata in this environment, so the page correctly switched to its manual episode fallback: the user can enter an episode number, choose Auto/360p/480p/720p, and then use Watch or Download. This is preferable to displaying a dead episode list or a download button that silently ignores quality.


The public watch route was checked at 720p. In the current sandbox provider state it correctly rendered a titled `Watch unavailable` state rather than a blank or misleading player, exposed Auto/360p/480p/720p/1080p retry links, and presented a source-status panel. This confirms the failure UX is honest and actionable; when a validated source is available, the same route renders the HLS/direct player and the same quality switcher.
