const ALLOWED_ORIGINS = new Set([
  "https://melodii7785.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null"
]);

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const USER_AGENT = "TOTALCHART/0.2.0 (https://github.com/Melodii7785/totalchart)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SPOTIFY_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const SPOTIFY_GET_TRACK_HASH = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294";
const SPOTIFY_TOTP_SECRETS_URL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/refs/heads/main/secrets/secretDict.json";
const SPOTIFY_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36";
const SPOTIFY_FALLBACK_APP_VERSION = "1.3.6.1874.gc66299947cb4";
const SPOTIFY_TRACK_ID_RE = /^[A-Za-z0-9]{22}$/;
const SPOTIFY_SECRET_FALLBACKS = [
  { version: 61, encoded: ',7/*F("rLJ2oxaKL^f+E1xvP@N' },
  { version: 60, encoded: 'OmE{ZA.J^":0FG\\Uz?[@WW' },
  { version: 59, encoded: '{iOFn;4}<1PFYKPV?5{%u14]M>/V0hDH' }
];

var spotifyAuthCache = null;
var spotifyAuthPromise = null;
var spotifySecretCache = null;
var spotifySecretCacheAt = 0;
var spotifyAppVersionCache = null;
var spotifyAppVersionCacheAt = 0;
var spotifyClientTokenCache = null;
var spotifyPlaycountCache = new Map();

function decodeSpotifySecretArray(values) {
  var digits = "";
  for (var i = 0; i < values.length; i += 1) {
    digits += String(Number(values[i]) ^ ((i % 33) + 9));
  }
  return new TextEncoder().encode(digits);
}

function decodeSpotifySecretString(encoded) {
  var digits = "";
  for (var i = 0; i < encoded.length; i += 1) {
    digits += String(encoded.charCodeAt(i) ^ ((i % 33) + 9));
  }
  return new TextEncoder().encode(digits);
}

async function getSpotifySecretCandidates() {
  if (spotifySecretCache && Date.now() - spotifySecretCacheAt < 3600000) {
    return spotifySecretCache;
  }

  var candidates = [];
  try {
    var response = await fetch(SPOTIFY_TOTP_SECRETS_URL, {
      headers: { "Accept": "application/json" },
      cf: { cacheEverything: true, cacheTtl: 3600 }
    });
    if (response.ok) {
      var dictionary = await response.json();
      candidates = Object.keys(dictionary || {})
        .map(function(version) {
          return { version: Number(version), values: dictionary[version] };
        })
        .filter(function(item) {
          return Number.isInteger(item.version) && Array.isArray(item.values) && item.values.length > 0;
        })
        .sort(function(a, b) { return b.version - a.version; })
        .map(function(item) {
          return { version: item.version, secret: decodeSpotifySecretArray(item.values) };
        });
    }
  } catch (error) {
    // The embedded fallback candidates below keep temporary GitHub outages from stopping lookups.
  }

  if (!candidates.length) {
    candidates = SPOTIFY_SECRET_FALLBACKS.map(function(item) {
      return { version: item.version, secret: decodeSpotifySecretString(item.encoded) };
    });
  }

  spotifySecretCache = candidates;
  spotifySecretCacheAt = Date.now();
  return candidates;
}

async function getSpotifyServerTime() {
  try {
    var response = await fetch("https://open.spotify.com/api/server-time", {
      headers: {
        "Accept": "application/json",
        "Origin": "https://open.spotify.com",
        "Referer": "https://open.spotify.com/",
        "User-Agent": SPOTIFY_USER_AGENT
      },
      cf: { cacheTtl: 0 }
    });
    if (response.ok) {
      var data = await response.json();
      if (Number.isFinite(Number(data.serverTime))) return Number(data.serverTime);
    }
  } catch (error) {
    // Local time is a fallback; TOTP remains short-lived.
  }
  return Math.floor(Date.now() / 1000);
}

async function generateSpotifyTotp(secret, timestampSeconds) {
  var counter = Math.floor(timestampSeconds / 30);
  var counterBytes = new Uint8Array(8);
  var view = new DataView(counterBytes.buffer);
  var high = Math.floor(counter / 0x100000000);
  var low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);

  var key = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  var signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterBytes));
  var offset = signature[signature.length - 1] & 0x0f;
  var binary = (
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff)
  ) >>> 0;
  return String(binary % 1000000).padStart(6, "0");
}

async function fetchSpotifyAppVersion() {
  if (spotifyAppVersionCache && Date.now() - spotifyAppVersionCacheAt < 3600000) {
    return spotifyAppVersionCache;
  }

  var version = SPOTIFY_FALLBACK_APP_VERSION;
  try {
    var response = await fetch("https://open.spotify.com/", {
      headers: {
        "Accept": "text/html",
        "User-Agent": SPOTIFY_USER_AGENT
      },
      cf: { cacheEverything: true, cacheTtl: 1800 }
    });
    if (response.ok) {
      var html = await response.text();
      var match = html.match(/<script[^>]*id=["']appServerConfig["'][^>]*>([^<]+)<\/script>/i);
      if (match && typeof atob === "function") {
        var decoded = atob(match[1].trim());
        var bytes = Uint8Array.from(decoded, function(character) { return character.charCodeAt(0); });
        var config = JSON.parse(new TextDecoder().decode(bytes));
        if (typeof config.clientVersion === "string" && config.clientVersion.length < 100) {
          version = config.clientVersion;
        }
      }
    }
  } catch (error) {
    // A recent captured version is used if Spotify's homepage config cannot be read.
  }

  spotifyAppVersionCache = version;
  spotifyAppVersionCacheAt = Date.now();
  return version;
}

async function fetchSpotifyAnonymousAccessToken() {
  var secrets = await getSpotifySecretCandidates();
  var serverTime = await getSpotifyServerTime();
  var lastError = null;

  for (var i = 0; i < secrets.length; i += 1) {
    var candidate = secrets[i];
    try {
      var code = await generateSpotifyTotp(candidate.secret, serverTime);
      var tokenUrl = new URL("https://open.spotify.com/api/token");
      tokenUrl.searchParams.set("reason", "init");
      tokenUrl.searchParams.set("productType", "web-player");
      tokenUrl.searchParams.set("totp", code);
      tokenUrl.searchParams.set("totpServer", code);
      tokenUrl.searchParams.set("totpVer", String(candidate.version));

      var response = await fetch(tokenUrl.toString(), {
        headers: {
          "Accept": "application/json",
          "Origin": "https://open.spotify.com",
          "Referer": "https://open.spotify.com/",
          "User-Agent": SPOTIFY_USER_AGENT
        },
        cf: { cacheTtl: 0 }
      });
      var data = await response.json();

      if (response.ok && typeof data.accessToken === "string" && data.accessToken) {
        if (data.isAnonymous === false) {
          throw new Error("Spotify returned a non-anonymous Web Player token.");
        }
        return {
          accessToken: data.accessToken,
          clientId: data.clientId || null,
          expiresAt: Number(data.accessTokenExpirationTimestampMs) || (Date.now() + 3300000)
        };
      }

      lastError = data && data.error && data.error.message
        ? data.error.message
        : "Spotify rejected the anonymous token request.";
    } catch (error) {
      lastError = error.message;
    }
  }

  throw new Error(lastError || "Could not obtain an anonymous Spotify Web Player token.");
}

async function fetchSpotifyClientToken(clientId, appVersion) {
  if (!clientId) return null;
  if (spotifyClientTokenCache && spotifyClientTokenCache.expiresAt > Date.now() + 3600000) {
    return spotifyClientTokenCache.token;
  }

  try {
    var response = await fetch("https://clienttoken.spotify.com/v1/clienttoken", {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_data: {
          client_version: appVersion,
          client_id: clientId,
          js_sdk_data: {
            device_brand: "unknown",
            device_model: "unknown",
            os: "linux",
            os_version: "unknown",
            device_id: crypto.randomUUID(),
            device_type: "computer"
          }
        }
      }),
      cf: { cacheTtl: 0 }
    });

    if (!response.ok) return null;
    var data = await response.json();
    var granted = data.granted_token;
    var token = typeof granted === "string" ? granted : (granted && granted.token);
    if (!token) return null;

    var lifetime = Number(data.expires_after_seconds) || 86400;
    spotifyClientTokenCache = {
      token: token,
      expiresAt: Date.now() + Math.max(60000, lifetime * 1000 - 60000)
    };
    return token;
  } catch (error) {
    return null;
  }
}

async function getSpotifyAuthContext() {
  if (spotifyAuthCache && spotifyAuthCache.expiresAt > Date.now() + 300000) {
    return spotifyAuthCache;
  }
  if (spotifyAuthPromise) return spotifyAuthPromise;

  spotifyAuthPromise = (async function() {
    var token = await fetchSpotifyAnonymousAccessToken();
    var appVersion = await fetchSpotifyAppVersion();
    var clientToken = await fetchSpotifyClientToken(token.clientId, appVersion);
    spotifyAuthCache = {
      accessToken: token.accessToken,
      clientToken: clientToken,
      appVersion: appVersion,
      expiresAt: token.expiresAt
    };
    return spotifyAuthCache;
  })();

  try {
    return await spotifyAuthPromise;
  } finally {
    spotifyAuthPromise = null;
  }
}

async function fetchSpotifyTrackPlaycount(trackId) {
  var auth = await getSpotifyAuthContext();
  var payload = {
    variables: {
      uri: "spotify:track:" + trackId,
      locale: "",
      preReleaseV2: false
    },
    operationName: "getTrack",
    extensions: {
      persistedQuery: {
        version: 1,
        sha256Hash: SPOTIFY_GET_TRACK_HASH
      }
    }
  };

  var headers = {
    "Accept": "application/json",
    "Content-Type": "application/json;charset=UTF-8",
    "Authorization": "Bearer " + auth.accessToken,
    "App-Platform": "WebPlayer",
    "Spotify-App-Version": auth.appVersion,
    "Origin": "https://open.spotify.com",
    "Referer": "https://open.spotify.com/",
    "User-Agent": SPOTIFY_USER_AGENT
  };
  if (auth.clientToken) headers["Client-Token"] = auth.clientToken;

  var response = await fetch(SPOTIFY_PATHFINDER_URL, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(payload),
    cf: { cacheTtl: 0 }
  });

  var data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Spotify Pathfinder returned an unreadable response.");
  }

  if (!response.ok || (Array.isArray(data.errors) && data.errors.length)) {
    var detail = Array.isArray(data.errors)
      ? data.errors.map(function(item) { return item.message; }).filter(Boolean).join("; ")
      : "";
    throw new Error(detail || ("Spotify Pathfinder returned HTTP " + response.status + "."));
  }

  var track = data && data.data && data.data.trackUnion;
  if (!track || track.__typename === "NotFound") {
    return {
      track_id: trackId,
      playcount: null,
      data_status: "unavailable",
      reason: "Spotify did not return this track."
    };
  }

  var uri = typeof track.uri === "string" ? track.uri : "";
  var returnedId = uri.indexOf("spotify:track:") === 0
    ? uri.slice("spotify:track:".length)
    : (typeof track.id === "string" ? track.id : "");
  if (returnedId && returnedId !== trackId) {
    throw new Error("Spotify returned a different track than the one requested.");
  }

  var rawCount = track.playcount;
  var result = {
    track_id: trackId,
    track_name: track.name || null,
    artist_names: Array.isArray(track.artists && track.artists.items)
      ? track.artists.items.map(function(item) { return item.profile && item.profile.name || item.name; }).filter(Boolean)
      : [],
    album_name: track.albumOfTrack && track.albumOfTrack.name || null,
    playcount: null,
    data_status: "unavailable",
    metric: "spotify_lifetime_playcount",
    unit: "plays",
    source: "Spotify Web Player Pathfinder",
    source_type: "unofficial",
    observed_at: new Date().toISOString()
  };

  if (rawCount === null || rawCount === undefined || rawCount === "") {
    result.reason = "Spotify did not include a playcount in this response.";
    return result;
  }

  var normalized = String(rawCount).replace(/,/g, "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error("Spotify returned a playcount in an unexpected format.");
  }
  var count = Number(normalized);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Spotify returned a playcount that could not be represented safely.");
  }

  result.playcount = count;
  result.data_status = "reported";
  if (count === 0) {
    result.interpretation_note = "A Spotify value of 0 can mean fewer than 1,000 plays; it is not proof of an exact zero.";
  }
  return result;
}

async function spotifyPlaycountResponse(trackId) {
  var memoryEntry = spotifyPlaycountCache.get(trackId);
  if (memoryEntry && memoryEntry.expiresAt > Date.now()) {
    return json(memoryEntry.data, 200, { "Cache-Control": "public, max-age=300, s-maxage=3600" });
  }

  try {
    var result = await fetchSpotifyTrackPlaycount(trackId);
    spotifyPlaycountCache.set(trackId, { data: result, expiresAt: Date.now() + 3600000 });
    if (spotifyPlaycountCache.size > 500) {
      var oldestKey = spotifyPlaycountCache.keys().next().value;
      spotifyPlaycountCache.delete(oldestKey);
    }
    return json(result, 200, { "Cache-Control": "public, max-age=300, s-maxage=3600" });
  } catch (error) {
    return json({
      error: "Spotify Pathfinder playcount lookup failed.",
      detail: error.message
    }, 502);
  }
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }, extraHeaders || {})
  });
}

function addCors(response, origin) {
  var headers = new Headers(response.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

async function musicBrainzResponse(targetUrl) {
  var upstream;
  try {
    upstream = await fetch(targetUrl, {
      headers: {
        "Accept": "application/json",
        "User-Agent": USER_AGENT
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 1800
      }
    });
  } catch (error) {
    return json({ error: "MusicBrainz could not be reached. Please try again later." }, 502);
  }

  var body = await upstream.text();
  if (!upstream.ok) {
    var message = upstream.status === 503
      ? "MusicBrainz is throttling requests. Please wait a moment and try again."
      : "MusicBrainz returned an error.";
    return json({ error: message, upstream_status: upstream.status }, upstream.status === 503 ? 503 : 502);
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function spotifyChartsResponse() {
  var upstream;
  try {
    upstream = await fetch("https://charts-spotify-com-service.spotify.com/public/v0/charts", {
      headers: {
        "Accept": "application/json",
        "Origin": "https://charts.spotify.com",
        "Referer": "https://charts.spotify.com/",
        "User-Agent": USER_AGENT
      },
      cf: {
        cacheEverything: true,
        cacheTtl: 1800
      }
    });
  } catch (error) {
    return json({ error: "Spotify Charts could not be reached. Please try again later." }, 502);
  }

  var body = await upstream.text();
  if (!upstream.ok) {
    return json({ error: "Spotify Charts returned an error.", upstream_status: upstream.status }, 502);
  }

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function handleRequest(request) {
  var url = new URL(request.url);
  var origin = request.headers.get("Origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "This origin is not allowed to use the TOTALCHART catalogue proxy." }, 403);
  }

  if (request.method === "OPTIONS") {
    return addCors(new Response(null, {
      status: 204,
      headers: { "Access-Control-Max-Age": "86400" }
    }), origin);
  }

  if (request.method !== "GET") {
    return addCors(json({ error: "Only GET requests are supported." }, 405, { "Allow": "GET, OPTIONS" }), origin);
  }

  if (url.pathname === "/health") {
    return addCors(json({
      service: "TOTALCHART MusicBrainz proxy",
      status: "ok",
      upstream: "MusicBrainz Web Service v2"
    }), origin);
  }

  if (url.pathname === "/api/spotify/global-weekly") {
    return addCors(await spotifyChartsResponse(), origin);
  }

  if (url.pathname === "/api/spotify/playcount") {
    var spotifyTrackId = (url.searchParams.get("id") || "").trim();
    if (!SPOTIFY_TRACK_ID_RE.test(spotifyTrackId)) {
      return addCors(json({ error: "A valid 22-character Spotify track ID is required." }, 400), origin);
    }
    return addCors(await spotifyPlaycountResponse(spotifyTrackId), origin);
  }

  var upstreamUrl;

  if (url.pathname === "/api/artists/search") {
    var query = (url.searchParams.get("q") || "").trim();
    if (query.length < 2 || query.length > 150) {
      return addCors(json({ error: "Search text must contain between 2 and 150 characters." }, 400), origin);
    }

    var limit = Math.min(25, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "15", 10) || 15));
    var searchParams = new URLSearchParams({ query: query, fmt: "json", limit: String(limit) });
    upstreamUrl = MUSICBRAINZ_BASE + "artist?" + searchParams.toString();
  } else {
    var match = url.pathname.match(/^\/api\/artists\/([^/]+)\/recordings$/);
    if (!match) {
      return addCors(json({ error: "Unknown endpoint." }, 404), origin);
    }

    var mbid = match[1];
    if (!UUID_RE.test(mbid)) {
      return addCors(json({ error: "The artist ID must be a valid MusicBrainz UUID." }, 400), origin);
    }

    var recordingLimit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100));
    var offset = Math.min(100000, Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0));
    var recordingParams = new URLSearchParams({
      artist: mbid,
      inc: "artist-credits isrcs",
      fmt: "json",
      limit: String(recordingLimit),
      offset: String(offset)
    });
    upstreamUrl = MUSICBRAINZ_BASE + "recording?" + recordingParams.toString();
  }

  return addCors(await musicBrainzResponse(upstreamUrl), origin);
}

addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});
