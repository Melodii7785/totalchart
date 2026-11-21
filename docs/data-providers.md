# Data providers

TOTALCHART separates catalogue discovery from commercial-performance observations. Providers can be replaced without changing the canonical JSON format in `data/schema.json`.

## 1. MusicBrainz — artist and recording discovery

**Status:** implemented.

The browser calls the TOTALCHART Worker proxy:

- `GET /api/artists/search?q=<name>&limit=15`
- `GET /api/artists/<musicbrainz-id>/recordings?limit=100&offset=0`
- `GET /health`

The Worker forwards requests to the MusicBrainz Web Service v2 and supplies the application User-Agent. Only these fixed routes are exposed; the Worker is not a general-purpose URL proxy.

MusicBrainz is a metadata catalogue. Its artist and recording results do not provide sales or streaming counts. Its API is free for non-commercial use, does not require an API key, requires a meaningful User-Agent, and asks clients to stay at or below one request per second. The browser adapter queues requests at least 1.1 seconds apart.

References:
- https://musicbrainz.org/doc/MusicBrainz_API
- https://musicbrainz.org/doc/MusicBrainz_API/Rate_Limiting

## 2. Spotify Charts public web feed — chart-period performance

**Status:** experimental.

The Worker reads the public web-service route used by Spotify Charts:

`https://charts-spotify-com-service.spotify.com/public/v0/charts`

This is an undocumented endpoint of Spotify's Charts website, not a supported Spotify Web API resource. Its response format or availability can change without notice. The current connector treats it as the Global weekly chart feed and only imports fields actually present in the response.

When a row includes `chartEntryData.rankingMetric.type === "STREAMS"`, its value is saved as `spotify_chart_eligible_streams` with a weekly period. If the response does not include a stream metric, TOTALCHART does not invent one; it can still preserve the chart position.

**Critical limitation:** Spotify says its chart stream counts are filtered for chart eligibility. They can differ from the complete stream counts displayed elsewhere in Spotify. They are chart-period values, not lifetime totals.

References:
- https://support.spotify.com/ve-en/artists/article/understanding-spotify-charts/
- https://stackoverflow.com/questions/78645242/how-to-automatically-download-csv-file-from-spotifys-global-chart

## 3. Spotify Web Player Pathfinder — experimental lifetime playcounts

**Status:** experimental Worker route and manual single-track lookup implemented; live end-to-end verification is still pending.

The browser sends a Spotify track ID to the TOTALCHART Worker:

`GET /api/spotify/playcount?id=<spotify-track-id>`

The Worker attempts to obtain an anonymous Spotify Web Player access token using the publicly documented-by-community TOTP flow, then calls the undocumented Pathfinder `getTrack` operation and reads `data.trackUnion.playcount`. No personal Spotify account cookies, login credentials, or user access tokens are requested or stored.

Returned observations identify the source as `Spotify Web Player Pathfinder`, the metric as `spotify_lifetime_playcount`, and include an observation timestamp. A missing field is stored as unavailable, never as zero. A returned value of `0` is preserved, but is displayed with a warning: community API documentation reports that Spotify may use this value for tracks below 1,000 plays, so it must not be interpreted as proof of an exact zero.

This route is not yet matched automatically to MusicBrainz recordings. The site currently offers a manual lookup by Spotify track URL or ID. Spotify can change or restrict the token flow, query hash, headers, or response format at any time. The route is not a supported Spotify API and currently has no guaranteed availability. Do not use this data as an audited sales or certification figure.

The recording browse request also asks MusicBrainz for `url-rels`. Where a recording has exactly one explicit URL relationship to an individual Spotify track, TOTALCHART exposes a per-recording lookup button. It does not infer a Spotify ID from a title, artist name, ISRC alone, or an album URL. Multiple distinct Spotify track links are treated as ambiguous and are not used.

## Import and export

The browser never writes directly to the repository. Use the export buttons to download a JSON dataset containing the catalogue entities and observations. Review it before replacing or merging `data/observations.json` in GitHub.

The export preserves existing arrays and merges entries by stable ID. Re-exporting the same chart date updates matching observation IDs instead of creating duplicates.

## What we are not using

- Last.fm: excluded from the provider plan.
- Soundcharts and Chartmetric: paid services.
- Apify scrapers: excluded because ongoing record collection costs money.
- Spotify Web API popularity: not treated as a stream-count substitute.

## Free-operation target

The site remains static on GitHub Pages. The small Cloudflare Worker only handles the two catalogue/chart upstream requests. It uses no database, no API keys, and no paid third-party analytics service. Keep an eye on the Cloudflare account's plan and usage; do not enable paid products for TOTALCHART.
