# Data providers

TOTALCHART separates catalogue metadata from commercial-performance observations. A Spotify ID or a track title is not a sales statistic.

## 1. Spotify catalogue search

**Status:** wired into the new search interface; Worker deployment is pending.

The browser calls the TOTALCHART Worker:

GET /api/spotify/search?q=<query>&type=all|track|album|artist

Search results come from Spotify's catalogue search endpoint and may contain tracks, albums, and artists. The returned IDs are Spotify IDs, and each result links back to its corresponding Spotify page.

Official reference: https://developer.spotify.com/documentation/web-api/reference/search

## 2. Spotify entity lookup

**Status:** implemented in the Worker source; Worker deployment is pending.

The browser requests one selected Spotify entity:

GET /api/spotify/lookup?type=track|album|artist&id=<spotify-id>

- **Track:** Pathfinder getTrack provides track metadata, associated album and artist IDs, and the lifetime playcount.
- **Album:** Spotify catalogue metadata provides album ID, artists, release date, album type, and track count.
- **Artist:** Pathfinder queryArtistOverview provides artist metadata and the current Top 10 list from the Spotify Web Player artist overview. Each listed track is looked up separately for its playcount.

The Artist Top 10 is a Web Player display list, not an official chart. Spotify removed the public Web API GET /artists/{id}/top-tracks endpoint in February 2026, so TOTALCHART does not depend on it.

Official changelog: https://developer.spotify.com/documentation/web-api/references/changes/february-2026

## 3. Spotify Web Player Pathfinder — lifetime playcounts

**Status:** experimental. The previous single-track route was successfully tested by the project owner. The new search-and-entity routes are committed but require Worker deployment.

The Worker uses the undocumented Web Player Pathfinder getTrack operation and reads data.trackUnion.playcount. It uses the anonymous Web Player token flow; it does not request a user's Spotify login, cookies, or personal access token.

Each reported playcount includes:
- Spotify track ID.
- Metric key spotify_lifetime_playcount.
- Unit plays.
- Source label Spotify Web Player Pathfinder.
- Capture timestamp.
- Reported or unavailable status.

A missing count remains unavailable, never zero. A returned 0 is preserved with an interpretation warning because Spotify may use that value for tracks below 1,000 plays. The interface is undocumented and may change or stop working.

## 4. Physical sales, digital purchases, and combined score

**Status:** not connected.

TOTALCHART does not currently have a verified free provider for physical sales or paid digital downloads. It does not fill those fields with estimates or Spotify popularity scores.

A cross-format score is not calculated yet. Raw lifetime streams, paid downloads, physical singles, and album purchases have different units and cannot be summed directly. Any future combined ranking must state its territory, time window, source coverage, treatment of missing values, and normalization formula. Missing coverage must not silently lower a score or be treated as zero.

## Architecture

- GitHub Pages serves the static HTML, CSS, and browser modules.
- The Cloudflare Worker provides fixed Spotify search and lookup routes.
- The Worker caches entity/search responses in memory and caches playcounts to reduce repeated upstream calls.
- No database or paid analytics service is required by the current prototype.
