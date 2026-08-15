# Pinterest image-fetch research

The official Pinterest REST API documentation states that applications must authenticate through the Pinterest developer platform. The public API documentation lists content-management and search-related API areas, but the search-partner-pins page did not expose an unauthenticated response in the browser session. Public search scraping would be brittle and may violate platform controls, so ARIA should not pretend to have a stable Pinterest API without a configured token.

Implementation decision: provide a Pinterest-style image batch command with a provider abstraction. If `PINTEREST_ACCESS_TOKEN` is configured, call the official partner search endpoint. Without it, use a clearly labeled safe public fallback provider rather than scraping Pinterest or sending fake images. The bot should return real image buffers or a transparent configuration/error message.

References:

1. https://developers.pinterest.com/docs/api/v5/ — Pinterest REST API overview and authentication prerequisite.
2. https://developers.pinterest.com/docs/api/v5/search_partner_pins/ — Official partner pin-search endpoint documentation.
