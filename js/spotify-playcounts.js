/**
 * Experimental Spotify Pathfinder play-count adapter.
 *
 * This uses Spotify's undocumented Web Player Pathfinder operation.
 * It is intentionally not wired into the public UI yet.
 *
 * Authentication must be supplied by an explicit, trusted integration.
 * Never put account cookies, access tokens, or client tokens in source code,
 * localStorage, URLs, logs, or committed files.
 */

const PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const GET_TRACK_HASH = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294";
const TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;

export function buildGetTrackPayload(trackId) {
  const id = String(trackId || "").trim();
  if (!TRACK_ID_RE.test(id)) {
    throw new Error("Enter a valid 22-character Spotify track ID.");
  }

  return {
    variables: {
      uri: "spotify:track:" + id,
      locale: "",
      preReleaseV2: false
    },
    operationName: "getTrack",
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: GET_TRACK_HASH
      }
    }
  };
}

export function parseSpotifyPlaycount(payload, expectedTrackId) {
  const track = payload?.data?.trackUnion;
  if (!track || typeof track !== "object") {
    const message = payload?.errors?.map(error => error.message).filter(Boolean).join("; ");
    throw new Error(message || "Spotify did not return a track record.");
  }

  const uri = typeof track.uri === "string" ? track.uri : "";
  const returnedId = uri.startsWith("spotify:track:") ? uri.slice("spotify:track:".length) : "";
  if (expectedTrackId && returnedId && returnedId !== expectedTrackId) {
    throw new Error("Spotify returned a different track than the one requested.");
  }

  const raw = track.playcount;
  if (raw === null || raw === undefined || raw === "") {
    return {
      track_id: returnedId || expectedTrackId || null,
      playcount: null,
      data_status: "unavailable",
      reason: "Spotify did not include a playcount in this response."
    };
  }

  const count = typeof raw === "number" ? raw : Number(String(raw).replace(/,/g, ""));
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Spotify returned a playcount that could not be parsed safely.");
  }

  return {
    track_id: returnedId || expectedTrackId || null,
    playcount: count,
    data_status: "reported",
    metric: "spotify_lifetime_playcount",
    unit: "plays"
  };
}

/**
 * Fetch one track's playcount.
 *
 * accessToken and clientToken are short-lived session credentials supplied by
 * the caller. This function does not obtain, persist, log, or refresh them.
 * Browser CORS may prevent direct calls from non-Spotify origins; use only a
 * trusted same-origin integration if a proxy is later added.
 */
export async function fetchSpotifyPlaycount(trackId, {
  accessToken,
  clientToken,
  appVersion,
  fetchImpl = fetch
} = {}) {
  if (!accessToken || !clientToken) {
    throw new Error("A trusted authentication integration must provide both Pathfinder tokens.");
  }

  const response = await fetchImpl(PATHFINDER_URL, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
      "Authorization": "Bearer " + accessToken,
      "Client-Token": clientToken,
      "App-Platform": "WebPlayer",
      ...(appVersion ? { "Spotify-App-Version": appVersion } : {})
    },
    body: JSON.stringify(buildGetTrackPayload(trackId))
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Pathfinder returned an unreadable response (HTTP " + response.status + ").");
  }

  if (!response.ok) {
    throw new Error("Pathfinder request failed (HTTP " + response.status + ").");
  }

  return parseSpotifyPlaycount(payload, trackId);
}

export const spotifyPathfinderPlaycountSource = {
  name: "Spotify Web Player Pathfinder",
  provider: "spotify_pathfinder",
  type: "unofficial",
  metric: "spotify_lifetime_playcount",
  endpoint: PATHFINDER_URL,
  operation: "getTrack",
  persisted_query_hash: GET_TRACK_HASH,
  caveat: "Undocumented interface; response availability and format may change."
};
