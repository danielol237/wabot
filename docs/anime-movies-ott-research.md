# Movies research findings

## Product direction

The new Movies surface should borrow generic OTT information architecture—featured backdrop, compact poster rails, genre/year filters, title details, and an explicit Watch/Where-to-watch action—without copying MovieBox brand assets or reverse-engineering unlicensed delivery systems.

## Official metadata and poster options

TMDb documents a v3 API for movie, TV, actor, and image data at https://developer.themoviedb.org/docs/getting-started. TMDb image URLs are constructed from a base URL, size, and file path; the documented example uses `https://image.tmdb.org/t/p/w500/{poster_path}`. Production use requires an API key and agreement to TMDb terms.

## Official availability option

Watchmode documents a REST API rooted at `https://api.watchmode.com/v1/`. Its title details and sources endpoints can return current regional availability, source names, and official web/app URLs for subscription, rental, purchase, or free sources. The implementation should treat these as outbound official availability links, not as downloadable media URLs. The country should be configurable (Cameroon is a launch target, but availability must be confirmed from the API rather than assumed).

## Implementation conclusion

The repository currently has an Anime catalog and media resolver but no movie router or movie catalog service. The safest next implementation is a shared OTT-style UI with a Movies tab backed by a curated metadata fallback and optional TMDb/Watchmode integrations. A movie card can show poster, year, rating, genres, and `Where to watch` links; it should not expose a download button unless the operator configures an authorized media source that passes the existing validation pipeline.
