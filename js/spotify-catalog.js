/**
 * Apple iTunes catalogue search and Spotify entity lookups for TOTALCHART.
 * Discovery uses Apple's public iTunes Search API. Spotify is used only
 * for the existing chart/statistics lookup after a catalogue selection.
 */

const ITUNES_SEARCH_URL = "https://itunes.apple.com/search";
const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";
const SPOTIFY_ID_FINDER_BASE = "https://totalchart-spotify-id-finder.melodii7785.workers.dev";

function mapITunesResult(type, item) {
  if (!item || typeof item !== "object") return null;
  const id = type === "track" ? item.trackId : type === "album" ? item.collectionId : item.artistId;
  if (id === undefined || id === null) return null;
  const name = type === "track" ? item.trackName : type === "album" ? item.collectionName : item.artistName;
  if (!name) return null;
  const artistName = item.artistName || "";
  const appleUrl = type === "track" ? item.trackViewUrl : type === "album" ? item.collectionViewUrl : item.artistViewUrl;

  return {
    type,
    id: String(id),
    name: String(name),
    artists: artistName && type !== "artist" ? [{ name: String(artistName) }] : [],
    artist_name: artistName || null,
    album_name: item.collectionName || null,
    release_date: item.releaseDate || null,
    duration_ms: Number.isFinite(item.trackTimeMillis) ? item.trackTimeMillis : null,
    isrc: typeof item.isrc === "string" ? item.isrc : null,
    genre: item.primaryGenreName || null,
    track_count: Number.isInteger(item.trackCount) ? item.trackCount : null,
    image_url: item.artworkUrl100 || item.artworkUrl60 || null,
    apple_url: appleUrl || null,
    source: "Apple iTunes Search API"
  };
}

async function searchITunesType(query, type) {
  const config = {
    track: { entity: "song", attribute: "songTerm" },
    album: { entity: "album", attribute: "albumTerm" },
    artist: { entity: "musicArtist", attribute: "artistTerm" }
  }[type];

  const params = new URLSearchParams({
    term: query,
    country: "br",
    media: "music",
    entity: config.entity,
    attribute: config.attribute,
    limit: "50"
  });

  let response;
  try {
    response = await fetch(ITUNES_SEARCH_URL + "?" + params.toString(), {
      headers: { "Accept": "application/json" }
    });
  } catch {
    throw new Error("Could not reach Apple's iTunes Search API. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("Apple's catalogue returned an unreadable response (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    throw new Error((data && data.errorMessage) || ("Apple's catalogue search failed (HTTP " + response.status + ")."));
  }

  return (Array.isArray(data.results) ? data.results : [])
    .map(item => mapITunesResult(type, item))
    .filter(Boolean);
}

export async function searchITunes(query, type = "all") {
  const q = String(query || "").trim();
  if (q.length < 2) throw new Error("Enter at least two characters.");
  if (q.length > 150) throw new Error("Search text is too long.");
  if (!["all", "track", "album", "artist"].includes(type)) {
    throw new Error("Choose tracks, albums, artists, or all results.");
  }

  const types = type === "all" ? ["track", "album", "artist"] : [type];
  const batches = await Promise.all(types.map(kind => searchITunesType(q, kind)));

  return {
    query: q,
    result_type: type,
    results: batches.flat(),
    source: "Apple iTunes Search API (Brazil storefront)",
    observed_at: new Date().toISOString()
  };
}

export async function findSpotifyMatches(item) {
  if (!item || !["track", "album", "artist"].includes(item.type)) {
    throw new Error("Choose a track, album, or artist from the iTunes results first.");
  }
  if (!item.name) {
    throw new Error("The selected iTunes result does not have a catalogue name.");
  }

  const payload = {
    type: item.type,
    name: String(item.name),
    artist_name: String(item.artist_name || (item.artists && item.artists[0] && item.artists[0].name) || ""),
    album_name: String(item.album_name || ""),
    release_date: String(item.release_date || ""),
    duration_ms: Number.isFinite(item.duration_ms) ? item.duration_ms : null,
    isrc: String(item.isrc || "")
  };

  let response;
  try {
    response = await fetch(SPOTIFY_ID_FINDER_BASE + "/resolve", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error("Could not reach the Spotify ID Finder. Check that its Cloudflare Worker is deployed.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The Spotify ID Finder returned an unreadable response (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const detail = data && (data.detail || data.error);
    const retry = response.headers.get("Retry-After");
    throw new Error(
      (detail || "Spotify ID matching failed (HTTP " + response.status + ").") +
      (response.status === 429 && retry ? " Try again in " + retry + " seconds." : "")
    );
  }

  return data;
}

async function requestJson(path) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      headers: { "Accept": "application/json" }
    });
  } catch {
    throw new Error("Could not reach the TotalChart lookup service. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The TotalChart lookup service returned an unreadable response (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    const detail = data && (data.detail || data.message);
    const message = detail
      ? (data.error ? data.error + ": " : "") + detail
      : (data && data.error) || ("Lookup request failed (HTTP " + response.status + ").");
    throw new Error(message);
  }

  return data;
}

export async function lookupSpotifyEntity(type, id) {
  if (!["track", "album", "artist"].includes(type)) {
    throw new Error("Choose a track, album, or artist.");
  }
  if (!/^[A-Za-z0-9]{22}$/.test(String(id || ""))) {
    throw new Error("That Spotify ID is not valid.");
  }
  const params = new URLSearchParams({ type, id });
  return requestJson("/api/spotify/lookup?" + params.toString());
}
