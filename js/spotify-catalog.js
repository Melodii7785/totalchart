
/**
 * MusicAPI catalogue search and Spotify entity lookups for TOTALCHART.
 * Public catalogue searches use the public Client ID. Entity statistics
 * continue through the existing TOTALCHART Worker.
 */

const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";
const MUSICAPI_CLIENT_ID = "8ce42097-f6e8-4794-8596-82c6a3b7a585";
const MUSICAPI_BASE = "https://api.musicapi.com";

function musicApiItem(type, item) {
  if (!item || !item.data || item.status !== "success") return null;
  const data = item.data;
  const id = data.externalId;
  if (!id) return null;
  const artists = Array.isArray(data.artistNames)
    ? data.artistNames.map(name => ({ name: String(name) }))
    : [];
  return {
    type,
    id: String(id),
    name: data.name || "Untitled",
    artists,
    image_url: data.imageUrl || null,
    release_date: data.releaseDate || data.release_date || null,
    album_name: data.albumName || null,
    spotify_url: data.url || (type === "track" || type === "album" || type === "artist"
      ? "https://open.spotify.com/" + type + "/" + encodeURIComponent(String(id))
      : null),
    total_tracks: Number.isInteger(data.totalTracks) ? data.totalTracks : null,
    source: "Spotify via MusicAPI"
  };
}

function musicApiAppleItem(type, item) {
  if (!item || !item.data || item.status !== "success") return null;
  const data = item.data;
  return {
    type,
    id: data.externalId || null,
    name: data.name || "Untitled",
    artists: Array.isArray(data.artistNames) ? data.artistNames.map(name => ({ name: String(name) })) : [],
    album_name: data.albumName || null,
    image_url: data.imageUrl || null,
    url: data.url || null,
    source: "Apple Music via MusicAPI"
  };
}

async function searchMusicAPI(query, type = "all") {
  const q = String(query || "").trim();
  if (q.length < 2) throw new Error("Enter at least two characters.");
  if (q.length > 150) throw new Error("Search text is too long.");
  if (!["all", "track", "album", "artist"].includes(type)) {
    throw new Error("Choose tracks, albums, artists, or all results.");
  }

  const types = type === "all" ? ["track", "album", "artist"] : [type];
  const payload = {
    type: type === "all" ? "track" : type,
    sources: ["appleMusic", "spotify"]
  };
  if (type === "track") payload.track = q;
  else if (type === "album") payload.album = q;
  else if (type === "artist") payload.artist = q;
  else {
    payload.track = q;
  }

  let response;
  try {
    response = await fetch(MUSICAPI_BASE + "/public/search", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "Authorization": "Token " + MUSICAPI_CLIENT_ID
      },
      body: JSON.stringify(payload)
    });
  } catch {
    throw new Error("Could not reach MusicAPI. Check your connection and try again.");
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("MusicAPI returned an unreadable response.");
  }
  if (!response.ok) {
    const detail = data.detail || data.error || data.message || "No further details were provided.";
    throw new Error("MusicAPI catalogue search failed (HTTP " + response.status + "): " + detail);
  }

  const results = [];
  const appleResults = [];
  types.forEach(kind => {
    const plural = kind === "artist" ? "artists" : kind + "s";
    const entries = Array.isArray(data[plural]) ? data[plural] : [];
    entries.forEach(entry => {
      if (entry.source === "spotify") {
        const mapped = musicApiItem(kind, entry);
        if (mapped) results.push(mapped);
      } else if (entry.source === "appleMusic") {
        const mapped = musicApiAppleItem(kind, entry);
        if (mapped) appleResults.push(mapped);
      }
    });
  });

  return {
    query: q,
    result_type: type,
    results,
    apple_results: appleResults,
    source: "MusicAPI catalogue (Apple Music discovery + Spotify matching)",
    observed_at: new Date().toISOString()
  };
}


function parseRetryAfter(value) {
  if (!value) return null;

  // Retry-After may be a number of seconds or an HTTP date.
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);

  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, Math.ceil((date - Date.now()) / 1000));
  }

  return null;
}

function formatRetryAfter(seconds) {
  if (seconds < 60) return seconds + " second" + (seconds === 1 ? "" : "s");

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes < 60) {
    return remainingSeconds
      ? minutes + " minute" + (minutes === 1 ? "" : "s") + " and " + remainingSeconds + " second" + (remainingSeconds === 1 ? "" : "s")
      : minutes + " minute" + (minutes === 1 ? "" : "s");
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes
    ? hours + " hour" + (hours === 1 ? "" : "s") + " and " + remainingMinutes + " minute" + (remainingMinutes === 1 ? "" : "s")
    : hours + " hour" + (hours === 1 ? "" : "s");
}

async function requestJson(path) {
  let response;

  try {
    response = await fetch(API_BASE + path, {
      method: "GET",
      headers: {
        Accept: "application/json"
      }
    });
  } catch {
    throw new Error(
      "Could not reach the TOTALCHART service. Check your connection and try again."
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      "The TOTALCHART service returned an unreadable response."
    );
  }

  if (!response.ok) {
    const detail = String(
      data.detail || data.error || data.message || ""
    );

    const retryAfter = parseRetryAfter(
      response.headers.get("Retry-After")
    );

    const rateLimited =
      response.status === 429 ||
      /rate.?limit|too many requests/i.test(detail);

    if (rateLimited) {
      const error = new Error(
        retryAfter !== null
          ? `Spotify is rate-limiting us. It says to retry after ${formatRetryAfter(retryAfter)}. Just wait.`
          : "Spotify is rate-limiting us but did not provide a retry time. Just wait a little."
      );

      error.code = "RATE_LIMITED";
      error.status = response.status;
      error.retryAfterSeconds = retryAfter;

      throw error;
    }

    if (
      response.status === 404 &&
      path.indexOf("/api/spotify/") === 0
    ) {
      throw new Error(
        "The Worker is still serving its older version. The new Spotify search and lookup routes need the updated Worker deployed."
      );
    }

    if (response.status === 502) {
      throw new Error(
        `TOTALCHART returned HTTP 502 (Worker gateway error). ${detail || "No error detail was provided."} The Worker does not expose the original upstream status or retry headers, so the cause is still unknown.`
      );
    }

    throw new Error(
      detail
        ? `${detail} (TOTALCHART HTTP ${response.status}).`
        : `TOTALCHART request failed (HTTP ${response.status}).`
    );
  }

  return data;
}

export async function searchSpotify(query, type = "all") {
  return searchMusicAPI(query, type);
}

export async function lookupSpotifyEntity(type, id) {
  if (!["track", "album", "artist"].includes(type)) {
    throw new Error("Choose a track, album, or artist.");
  }

  if (!/^[A-Za-z0-9]{22}$/.test(String(id || ""))) {
    throw new Error("That Spotify ID is not valid.");
  }

  const params = new URLSearchParams({
    type,
    id
  });

  return requestJson(
    "/api/spotify/lookup?" + params.toString()
  );
}
