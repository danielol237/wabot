# ARIA Anime V11 backend decision

The public anime experience has two separate backend problems. The first is **application state**: sessions, watch history, favorites, catalog cache, provider health, and durable download-job records. The second is **media availability**: an authorized source that actually returns playable episodes and, where allowed, downloadable files. A database solves the first problem only.

| Approach | What it improves | Tradeoffs | Cost | Setup complexity |
|---|---|---|---|---|
| Keep the current Render service and local job manager | Fastest path; no migration; yt-dlp/ffmpeg remain available; good for one operator and short-lived jobs | Local queue and files are vulnerable to restarts; public sessions need cookie repair; no cross-device history | Lowest immediate cost | Low |
| Add Supabase for state, while keeping media resolution on the existing Render worker | Durable sessions, favorites, watch history, provider-health records, and queued-job metadata; better multi-device UX | Still cannot repair dead providers or create media; requires RLS, secret management, cleanup rules, and a worker-to-database contract | Supabase plan/API usage plus existing Render | Medium |
| Add Supabase plus a separate licensed/operator-owned media backend | Durable state and a reliable source/storage boundary; suitable for a paid product if rights and storage are controlled | Highest operational and legal responsibility; requires ingest, storage, transcoding, CDN, takedown, and monitoring | Highest | High |
| Replace direct scrapers with official provider-availability links | Removes brittle direct-source promises; gives users stable legal watch destinations and region-aware provider choices | Does not provide ARIA-hosted playback or direct downloads; users leave ARIA to watch | Low to medium, depending on availability API | Medium |

## Decision

The immediate best value is to keep the existing Render service, fix the public session cookie, add dark/light theming, and replace dead direct-source promises with a provider-availability rail that can link to official services. Supabase becomes worthwhile after the product has either authenticated users who need cross-device state or an operator-owned/licensed media backend whose jobs must survive restarts. It is not worth introducing Supabase solely to compensate for stale scrapers.

The code should keep a clean seam for a future Supabase adapter: `catalog_cache`, `anime_sessions`, `watch_progress`, `favorites`, `provider_health`, and `download_jobs`. None of those tables should store or expose arbitrary upstream URLs; media URLs remain short-lived, signed, and validated by the Render worker.
