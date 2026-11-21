/**
 * Spotify catalogue search and entity lookups for TOTALCHART.
 * All upstream requests are sent through the TOTALCHART Worker.
 */

const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";

async function requestJson(path) {
  let response;
  try {
    response = await fetch(API_BASE + path, {
      method: "GET",
      headers: { "Accept": "application/json" }
    });
  } catch {
    throw new Error("Could not reach the TOTALCHART service. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The TOTALCHART service returned an unreadable response.");
  }

  if (!response.ok) {
    if (response.status === 404 && path.indexOf("/api/spotify/") === 0) {
      throw new Error("The Worker is still serving its older version. The new Spotify search and lookup routes need the updated Worker deployed.");
    }
    throw new Error(data.detail || data.error || "TOTALCHART request failed (HTTP " + response.status + ").");
  }
  return data;
}

export async function searchSpotify(query, type = "all") {
  const q = String(query || "").trim();
  if (q.length < 2) throw new Error("Enter at least two characters.");
  if (q.length > 150) throw new Error("Search text is too long.");
  if (!["all", "track", "album", "artist"].includes(type)) {
    throw new Error("Choose tracks, albums, artists, or all results.");
  }

  const params = new URLSearchParams({ q, type });
  return requestJson("/api/spotify/search?" + params.toString());
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
