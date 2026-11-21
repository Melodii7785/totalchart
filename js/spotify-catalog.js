
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

  async function searchType(kind) {
    const payload = {
      type: kind,
      sources: ["appleMusic", "spotify"]
    };
    payload[kind] = q;

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
    return { kind, data };
  }

  const responses = await Promise.all(types.map(searchType));
  const results = [];
  const appleResults = [];

  responses.forEach(({ kind, data }) => {
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
