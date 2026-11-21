/**
 * TOTALCHART adapter for the experimental Spotify Pathfinder playcount route.
 *
 * The browser sends only a validated Spotify track ID to our Worker.
 * Anonymous Web Player authentication is handled server-side by the Worker.
 * No personal Spotify cookies, login tokens, or Developer API credentials are
 * requested by this module.
 */

const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";
const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

export function parseSpotifyTrackId(input) {
  const value = String(input || "").trim();
  if (TRACK_ID_RE.test(value)) return value;

  try {
    const url = new URL(value);
    if (!/(^|\\.)spotify\\.com$/i.test(url.hostname)) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const trackIndex = parts.indexOf("track");
    const id = trackIndex >= 0 ? parts[trackIndex + 1] : null;
    return id && TRACK_ID_RE.test(id) ? id : null;
  } catch {
    return null;
  }
}

export async function fetchSpotifyPlaycount(trackId, { fetchImpl = fetch } = {}) {
  const id = String(trackId || "").trim();
  if (!TRACK_ID_RE.test(id)) {
    throw new Error("Enter a valid Spotify track URL or 22-character track ID.");
  }

  let response;
  try {
    response = await fetchImpl(
      API_BASE + "/api/spotify/playcount?id=" + encodeURIComponent(id),
      { method: "GET", headers: { "Accept": "application/json" } }
    );
  } catch {
    throw new Error("Could not reach the TOTALCHART Worker. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("The TOTALCHART Worker returned an unreadable response.");
  }

  if (!response.ok) {
    throw new Error(data.detail || data.error || "Spotify playcount lookup failed (HTTP " + response.status + ").");
  }

  if (data.track_id !== id) {
    throw new Error("The Worker returned a different Spotify track ID.");
  }

  return data;
}

export const spotifyPathfinderPlaycountSource = {
  name: "Spotify Web Player Pathfinder",
  provider: "spotify_pathfinder",
  type: "unofficial",
  metric: "spotify_lifetime_playcount",
  endpoint: "https://api-partner.spotify.com/pathfinder/v2/query",
  operation: "getTrack",
  caveat: "Undocumented interface. Spotify may change or restrict it without notice."
};
