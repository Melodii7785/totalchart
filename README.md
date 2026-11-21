# TOTALCHART

**I'm Going Crazy! another music utility from my stupid brain. bravo!**

TOTALCHART is a cross-format music database. The goal is to compare music performance across streaming, physical sales, and paid digital purchases without pretending those are all the same unit.

There will be numbers. There will be sources. There will be arguments about methodology. There may be Britney Spears.

## WHAT THE HELL IS THIS

Search for a track, album, or artist in Spotify's catalogue.

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

### Spotify catalogue search

The search interface uses Spotify's catalogue search endpoint to find tracks, albums, and artists. Search results include Spotify IDs and links to the corresponding Spotify pages.

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
- Keep testing the Spotify lookup as its undocumented endpoints evolve.

## STATUS

**EARLY PROTOTYPE. UNDER CONSTRUCTION.**

If something breaks, that's unfortunate. If something breaks for the fourteenth time, that's a tradition.

There's 3 dollars. Over There.

---
*TOTALCHART — built with HTML, questionable levels of enthusiasm, and the determination to make music statistics less annoying.*
