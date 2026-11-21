# TOTALCHART

**I'm Going Crazy! another music utility from my stupid brain. bravo!**

TOTALCHART is a cross-format music database. The goal is to compare music performance across streaming, physical sales, and paid digital purchases without pretending those are all the same unit.

There will be numbers. There will be sources. There will be arguments about methodology. There may be Britney Spears.

## WHAT THE HELL IS THIS

Search for a track, album, or artist in Apple's iTunes music catalogue, then find its matching Spotify ID.

- **Track:** open its Spotify ID, linked album and artist IDs, and lifetime playcount.
- **Album:** open its Spotify album ID, release metadata, artists, and track count.
- **Artist:** open its artist ID and the Top 10 tracks currently listed in Spotify's Web Player artist overview, with an individual playcount lookup for each track.

Nothing is preloaded. Search results are fetched when requested.

## HOW TO RUN THIS THING

1. Download or clone the repository.
2. Serve the folder over HTTP (for example, run python -m http.server 5500).
3. Open http://localhost:5500.
4. Or visit the hosted GitHub Pages site.

The page uses JavaScript modules and a Cloudflare Worker. Opening index.html directly as a file URL is not a reliable way to run it.

No React. No Tailwind. No package manager. No seventeen-step ritual. Just HTML, CSS, and vanilla JavaScript.

## THE DATA RULES. YES, THERE ARE RULES.

**We do not invent statistics.**

Spotify lifetime playcounts are one metric. Physical copies and paid digital purchases are separate metrics. A raw stream count, a CD single purchase, and a paid download cannot simply be added together as though they were identical.

Every performance observation should include:
- A source.
- A territory.
- A reporting period or capture date.
- A clear indication of whether the figure is reported or estimated.
- A definition of what product or activity was counted.

Missing information is unavailable. It is NOT zero. A combined cross-format score stays uncalculated until comparable sourced data exists and the normalization method is explicit.

An album purchase is not a separate purchase of every individual track unless the source methodology explicitly allocates it that way.

## LIVE DATA PROVIDERS

### iTunes catalogue discovery

The search interface uses Apple's public iTunes Search API to find tracks, albums, and artists. iTunes IDs identify Apple catalogue entries; they are not treated as Spotify IDs.

### Spotify ID finder

After an iTunes result is selected, a separate Cloudflare Worker uses Spotify's documented Web API Search endpoint to find possible Spotify counterparts. Candidates are ranked against the selected title, artist, album, and available release metadata. The user chooses the matching Spotify result before the existing TotalChart lookup runs.

The Worker uses Spotify's OAuth 2.0 Client Credentials flow. Set the following as Worker secrets on `totalchart-spotify-id-finder` (never commit them to GitHub or put them in browser code):

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`

The app owner must meet Spotify's current Developer Mode eligibility requirements. Spotify's current documentation says Development Mode apps require an active Premium subscription for the app owner. See the [Spotify Development Mode guide](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) and [Client Credentials documentation](https://developer.spotify.com/documentation/web-api/tutorials/client-credentials-flow).

### Spotify Web Player Pathfinder

The Worker uses the undocumented Web Player Pathfinder getTrack operation to read data.trackUnion.playcount. The artist page uses the Web Player artist-overview operation to retrieve the tracks currently listed in the artist's Top 10 section.

The artist Top 10 is **not an official chart**. Spotify removed the public Web API GET /artists/{id}/top-tracks endpoint in February 2026, so the project does not rely on that removed endpoint.

The Pathfinder interface and anonymous token flow are undocumented and can change without notice. Playcounts are timestamped and identified as an unofficial source. A value of 0 may represent fewer than 1,000 plays; it is not proof of an exact zero.

### Physical and digital sales

No physical-sales or paid-download provider is connected yet. Those fields are shown as unavailable, not guessed. The combined score is not calculated while those inputs are missing.

Provider details and caveats live in docs/data-providers.md. The canonical data format is in data/schema.json.

## THE ROAD AHEAD

- Connect verifiable physical-sales and paid-download sources.
- Record territory and time coverage for every observation.
- Define a transparent, comparable cross-format ranking method.
- Add reviewed exports for sourced observations.
- Keep the iTunes discovery and documented Spotify ID finder current.
- Keep testing the separate Spotify playcount lookup as its undocumented source evolves.

## STATUS

**EARLY PROTOTYPE. UNDER CONSTRUCTION.**

If something breaks, that's unfortunate. If something breaks for the fourteenth time, that's a tradition.

There's 3 dollars. Over There.

---
*TOTALCHART — built with HTML, questionable levels of enthusiasm, and the determination to make music statistics less annoying.*
