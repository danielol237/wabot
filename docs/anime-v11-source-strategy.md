# ARIA Anime V11 source and backend strategy

## Current user-visible failure

The mobile screenshot shows the public file endpoint returning `This download job belongs to another session.` The current code derives the public owner from `req.ip` or the socket address and verifies both the file token and the job owner against that value. Because Render can sit behind a proxy and because a download can cross requests with different address representations, the current owner binding is too fragile for a public mobile flow. The fix should use a signed, HttpOnly public-anime session cookie as the stable anonymous owner, while retaining the IP only as a rate-limit signal. A file token must remain short-lived and bound to the session cookie, but it should not be bound directly to a changing socket/IP value.

## Source findings

AniList is a strong catalog identity source. Its primary documentation describes a GraphQL API with a large anime dataset and a flexible query model. It is suitable for titles, posters, genres, season metadata, ratings, and canonical IDs, but it does not provide licensed video files or guarantee a playable episode source. [1]

Jikan is a useful secondary metadata source but is explicitly an unofficial MyAnimeList scraper. Its documentation states that it is read-only, caches responses for 24 hours, and can be rate-limited or return upstream/parser/service-unavailable errors. It is suitable as a metadata fallback, not as the anime media backend. [2]

The current Consumet/scraper strategy is not a dependable foundation for a money-making product. The local audit reproduced stale domains, DNS failures, 522 responses, 403/404 responses, title mismatches, and intermittent direct-CDN behavior. Replacing one scraper hostname with another would create the same operational problem unless the replacement is a maintained, authorized media API or an operator-controlled source account.

## Supabase decision at this stage

Supabase can improve persistent application state: anonymous/public sessions, user accounts, watch history, favorites, catalog caching, download-job records, provider health, and signed download metadata. Supabase cannot create video availability, repair a dead upstream CDN, provide streaming rights, or make an unofficial scraper stable. The correct order is therefore: first identify an authorized or operator-controlled media source; then use Supabase if persistent cross-device state and durable jobs are worth adding.

## References

[1]: https://docs.anilist.co/ "AniList API documentation"
[2]: https://docs.api.jikan.moe/ "Jikan API documentation"


## Lawful availability alternatives

TMDB's watch-provider endpoint is powered by a JustWatch partnership and can return country-specific streaming, rental, and purchase availability. Its documentation explicitly says it does not return full deep links and requires JustWatch attribution; it is therefore suitable for a provider rail and official deep-link buttons, not for proxying or downloading video. [3]

Movie of the Night's Streaming Availability API describes a richer commercial option with universal deep links, service, country, quality, audio, subtitle, price, and expiry metadata. That model is much closer to a professional discovery product, but it still points users to the licensed streaming service; it does not turn ARIA into a legal file host. [4]

The source decision is therefore split. For a rights-safe product, replace failing direct scrapers with a provider-availability rail that links to Crunchyroll, Netflix, HIDIVE, or other services available in the user's region. For operator-owned media, add a separate authenticated storage/source adapter; do not expect Supabase or a metadata API to supply the files.

## References

[3]: https://developer.themoviedb.org/reference/movie-watch-providers "TMDB movie watch providers"
[4]: https://www.movieofthenight.com/about/api "Streaming Availability API"


## V11 visual check

The local preview now exposes a persistent `Dark`/`Light` control in the anime header. The light theme keeps the warm editorial canvas from V10; toggling it changes the full shell, hero, cards, quick-start panel, controls, and footer to a restrained dark surface while keeping the orbital-ribbon ARIA mark readable. The toggle persists through `localStorage` and respects the device color preference on first load.
