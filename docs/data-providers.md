# Data providers

TOTALCHART separates catalogue metadata from commercial-performance observations. A Spotify ID or a track title is not a sales statistic.

## 1. iTunes catalogue discovery

**Status:** live in the GitHub Pages search interface.

The browser calls Apple's public iTunes Search API:

GET https://itunes.apple.com/search

The search UI uses the Brazil storefront and searches the requested entity type:
- Track: `entity=song`, `attribute=songTerm`
- Album: `entity=album`, `attribute=albumTerm`
- Artist: `entity=musicArtist`, `attribute=artistTerm`

The API returns Apple catalogue IDs and metadata such as names, artist names, album names, artwork, release dates, and track durations. Apple IDs are not Spotify IDs.

Official reference: https://performance-partners.apple.com/search-api

## 2. Spotify ID finder

**Status:** source committed; Cloudflare Worker deployment and Spotify app secrets must be configured.

The browser sends the selected iTunes metadata to the separate `totalchart-spotify-id-finder` Worker:

POST /resolve

The Worker uses Spotify's documented OAuth 2.0 Client Credentials flow and official Web API Search endpoint. It searches the selected entity type in the Brazil market, compares candidate names and associated metadata, then returns ranked Spotify IDs. TotalChart displays those candidates and lets the user choose the correct Spotify entry before loading its statistics.

The Worker requires two Cloudflare secrets:
- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

Do not put these credentials in GitHub or browser JavaScript. Spotify's current Development Mode eligibility requirements include an active Premium subscription for the app owner. See:
- https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow
- https://developer.spotify.com/documentation/web-api/reference/search
- https://developer.spotify.com/documentation/web-api/concepts/quota-modes

## 3. Spotify entity lookup

**Status:** implemented in the existing TOTALCHART Worker.

The browser requests one selected Spotify entity:

GET /api/spotify/lookup?type=track|album|artist&id=<spotify-id>

- **Track:** Pathfinder getTrack provides track metadata, associated album and artist IDs, and the lifetime playcount.
- **Album:** Spotify catalogue metadata provides album ID, artists, release date, album type, and track count.
- **Artist:** Pathfinder queryArtistOverview provides artist metadata and the current Top 10 list from the Spotify Web Player artist overview. Each listed track is looked up separately for its playcount.

The Artist Top 10 is a Web Player display list, not an official chart. Spotify removed the public Web API GET /artists/{id}/top-tracks endpoint in February 2026, so TOTALCHART does not depend on it.

Official changelog: https://developer.spotify.com/documentation/web-api/references/changes/february-2026

## 4. Spotify Web Player Pathfinder — lifetime playcounts

**Status:** experimental.

The existing Worker uses the undocumented Web Player Pathfinder getTrack operation and reads data.trackUnion.playcount. It uses the existing Web Player token integration. The ID finder does not use this mechanism; it uses Spotify's documented OAuth flow and Search API.

Each reported playcount includes:
- Spotify track ID.
- Metric key spotify_lifetime_playcount.
- Unit plays.
- Source label Spotify Web Player Pathfinder.
- Capture timestamp.
- Reported or unavailable status.

A missing count remains unavailable, never zero. A returned 0 is preserved with an interpretation warning because Spotify may use that value for tracks below 1,000 plays. The playcount source is undocumented and may change or stop working.

## 4. Physical sales, digital purchases, and combined score

**Status:** not connected.

TOTALCHART does not currently have a verified free provider for physical sales or paid digital downloads. It does not fill those fields with estimates or Spotify popularity scores.

A cross-format score is not calculated yet. Raw lifetime streams, paid downloads, physical singles, and album purchases have different units and cannot be summed directly. Any future combined ranking must state its territory, time window, source coverage, treatment of missing values, and normalization formula. Missing coverage must not silently lower a score or be treated as zero.

## Architecture

- GitHub Pages serves the static HTML, CSS, and browser modules.
- The existing Cloudflare Worker serves Spotify entity statistics.
- A separate Cloudflare Worker, `totalchart-spotify-id-finder`, handles documented Spotify Web API ID matching with server-side credentials.
- The browser uses Apple's iTunes Search API for catalogue discovery.
- Both Workers keep credentials server-side; the ID Finder caches its app token and short-lived search responses in memory.
- No database or paid analytics service is required by the current prototype.
