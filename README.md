# TOTALCHART

**I'm Going Crazy! another music utility from my stupid brain. bravo!**

Welcome to TOTALCHART, the music database that asks the important question:

**What if we stopped pretending that music history began when Spotify showed up?**

This is an independent little project trying to bring streaming, physical sales and digital purchases into one place, so an artist's commercial history doesn't get flattened into a list of whatever has the biggest stream count this morning.

There will be numbers. There will be sources. There will be arguments about methodology. There may be Britney Spears.

## WHAT THE HELL IS THIS

TOTALCHART is an early prototype for a cross-format music database.

The long-term idea is to document:

- Streaming figures.
- Physical single and album sales.
- Digital song and album purchases.
- Where each figure came from.
- Which country or territory it covers.
- When it was reported, and whether it's an estimate.

The goal is to make the data useful without making up numbers to fill empty boxes. We are serious about the data. We are not serious about having a boring README.

## HOW TO RUN THIS THING

1. Download or clone the repository.
2. Serve the folder over HTTP (for example, run `python -m http.server 5500` in the repository folder).
3. Open `http://localhost:5500`.
4. Or visit the hosted GitHub Pages site.

The page now uses JavaScript modules and the catalogue proxy, so opening `index.html` directly as a `file://` URL is not a reliable way to run it.

No React. No Tailwind. No package manager. No seventeen-step ritual. Just HTML, CSS, and vanilla JavaScript.

## WHAT WORKS SO FAR

- A deliberately old-web-looking homepage.
- A search-first homepage with no preloaded artists or songs.
- Live MusicBrainz artist search and recording discovery.
- Artist and recording results fetched on demand and displayed in the browser.
- An experimental Spotify Global weekly chart connector.
- Dated chart observations, kept separate from lifetime stream totals.
- Missing physical and digital sales are marked unavailable.
- A methodology section explaining why raw streams and sales units aren't automatically interchangeable.

It's a prototype. Some bits are held together with enthusiasm and questionable life choices. Please be patient.

## THE DATA RULES. YES, THERE ARE RULES.

**We do not invent statistics.**

The homepage does not ship with preloaded artist or song statistics. Artist and recording metadata is fetched when someone searches. Performance statistics are a separate layer and are only displayed when a provider supplies a sourced figure.

Missing information is labelled as unavailable or not researched. It is NOT zero. An empty box is an empty box. It is not an invitation to make up 4.7 million copies.

Every statistic should eventually have:
- A source.
- A territory.
- A reporting period or capture date.
- A clear indication of whether it is reported or estimated.

And please, for the love of all things pop music, do not add raw streams, CD singles and paid downloads together as if they are identical units. Any combined score needs a documented methodology. We are building a database, not a calculator with delusions of grandeur.

## LIVE DATA DISCOVERY

MusicBrainz powers artist and recording discovery. The browser talks to a small Cloudflare Worker proxy so the MusicBrainz requests can include TOTALCHART's application User-Agent and obey the one-request-per-second limit.

The experimental Spotify Charts connector reads a public web endpoint used by Spotify Charts. It is undocumented and may break. Stream counts are imported only when the response contains them, and they are stored as chart-period values rather than lifetime totals. Spotify filters chart streams for eligibility.

Provider details and caveats live in [docs/data-providers.md](docs/data-providers.md). The canonical format is in [data/schema.json](data/schema.json).

The search interface displays live catalogue results; it does not pretend that those results are stored as verified commercial statistics. The canonical data format is available for reviewed imports into `data/observations.json`.

## RESEARCH STARTING POINTS

- [Luminate methodology](https://support.luminatedata.com/portal/en/kb/articles/methodology)
- [IFPI Global Music Report 2026 methodology](https://gmr.ifpi.org/downloads/GMR2026_Methodology.pdf)

These are references for understanding industry measurement. They do not magically provide every artist's sales figures. If only.

## THE ROAD AHEAD

The next jobs include:
- Individual song pages.
- Individual artist pages with actual release data.
- A proper data structure for figures and sources.
- Performance-data providers for artists and recordings selected through search.
- A transparent chart calculation method.
- A lot of research. A frankly unreasonable amount of research.

## STATUS

**EARLY PROTOTYPE. UNDER CONSTRUCTION.**

If something breaks, that's unfortunate. If something breaks for the fourteenth time, that's a tradition.

There's 3 dollars. Over There.

---
*TOTALCHART — built with HTML, questionable levels of enthusiasm, and the determination to make music statistics less annoying.*

## EXPERIMENTAL SPOTIFY PLAY COUNTS

An isolated adapter now exists at `js/spotify-playcounts.js`. It builds the documented `getTrack` Pathfinder request and parses `data.trackUnion.playcount` into a sourced lifetime-playcount observation shape.

This is **not connected to the homepage yet** and has not passed a live end-to-end request. Spotify's Pathfinder interface is undocumented and requires web-player authentication headers. The adapter accepts credentials from an explicitly supplied integration; it does not collect, refresh, store, or log account cookies or tokens. Do not paste session credentials into the repository or commit them.

The adapter deliberately keeps a missing `playcount` as unavailable rather than converting it to zero. Before integration, the authentication and request path need a secure design, and the response needs a live test against multiple tracks.
