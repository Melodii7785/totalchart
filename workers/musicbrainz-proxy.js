const ALLOWED_ORIGINS = new Set([
  "https://melodii7785.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null"
]);

const SPOTIFY_PATHFINDER_URL = "https://api-partner.spotify.com/pathfinder/v2/query";
const SPOTIFY_GET_TRACK_HASH = "612585ae06ba435ad26369870deaae23b5c8800a256cd8a57e08eddc25a37294";
const SPOTIFY_GET_ALBUM_HASH = "b9bfabef66ed756e5e13f68a942deb60bd4125ec1f1be8cc42769dc0259b4b10";
const SPOTIFY_GET_ARTIST_HASH = "ae0e2958a4ab645b35ca19ac04d0495ae12d9c5d7b7286217674801a9aab281a";
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
var spotifySearchCache = new Map();
var spotifyEntityCache = new Map();

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

async function fetchSpotifyPathfinder(operationName, queryHash, variables) {
  var auth = await getSpotifyAuthContext();
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
    body: JSON.stringify({
      variables: variables,
      operationName: operationName,
      extensions: {
        persistedQuery: { version: 1, sha256Hash: queryHash }
      }
    }),
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
  return data.data || {};
}

function spotifyEntityId(uri, type) {
  if (typeof uri !== "string") return null;
  var prefix = "spotify:" + type + ":";
  if (uri.indexOf(prefix) === 0) {
    var id = uri.slice(prefix.length);
    return /^[A-Za-z0-9]{22}$/.test(id) ? id : null;
  }
  return null;
}

function spotifyArtistItems(track) {
  var items = track && track.artists && Array.isArray(track.artists.items)
    ? track.artists.items
    : [];
  return items.map(function(item) {
    var profile = item.profile || {};
    var id = spotifyEntityId(item.uri, "artist") ||
      spotifyEntityId(profile.uri, "artist") ||
      (typeof item.id === "string" && /^[A-Za-z0-9]{22}$/.test(item.id) ? item.id : null);
    return {
      id: id,
      name: profile.name || item.name || "Unknown artist",
      spotify_url: id ? "https://open.spotify.com/artist/" + id : null
    };
  });
}

async function fetchSpotifyTrackPlaycount(trackId) {
  var data = await fetchSpotifyPathfinder("getTrack", SPOTIFY_GET_TRACK_HASH, {
    uri: "spotify:track:" + trackId,
    locale: "",
    preReleaseV2: false
  });

  var track = data.trackUnion;
  if (!track || track.__typename === "NotFound") {
    return {
      entity_type: "track",
      track_id: trackId,
      playcount: null,
      data_status: "unavailable",
      reason: "Spotify did not return this track."
    };
  }

  var uri = typeof track.uri === "string" ? track.uri : "";
  var returnedId = spotifyEntityId(uri, "track") || trackId;
  if (returnedId !== trackId) {
    throw new Error("Spotify returned a different track than the one requested.");
  }

  var album = track.albumOfTrack || track.album || {};
  var albumId = spotifyEntityId(album.uri, "album") ||
    (typeof album.id === "string" && /^[A-Za-z0-9]{22}$/.test(album.id) ? album.id : null);
  var artists = spotifyArtistItems(track);
  var images = (album.coverArt && album.coverArt.sources) ||
    (Array.isArray(album.images) ? album.images : []) ||
    (track.coverArt && track.coverArt.sources) || [];
  var artwork = images[0] && images[0].url || null;
  var duration = track.duration && track.duration.totalMilliseconds ||
    track.trackDuration && track.trackDuration.totalMilliseconds || null;

  var result = {
    entity_type: "track",
    track_id: trackId,
    track_name: track.name || "Unknown track",
    spotify_url: "https://open.spotify.com/track/" + trackId,
    artists: artists,
    artist_names: artists.map(function(item) { return item.name; }),
    artist_ids: artists.map(function(item) { return item.id; }).filter(Boolean),
    album_id: albumId,
    album_name: album.name || null,
    album_url: albumId ? "https://open.spotify.com/album/" + albumId : null,
    artwork_url: artwork,
    duration_ms: duration,
    playcount: null,
    data_status: "unavailable",
    metric: "spotify_lifetime_playcount",
    unit: "plays",
    source: "Spotify Web Player Pathfinder",
    source_type: "unofficial",
    observed_at: new Date().toISOString(),
    physical_sales: null,
    digital_downloads: null,
    cross_format_score: null
  };

  var rawCount = track.playcount;
  if (rawCount === null || rawCount === undefined || rawCount === "") {
    result.reason = "Spotify did not include a playcount in this response.";
    return result;
  }

  var normalized = String(rawCount).replace(/,/g, "").trim();
  if (!/^\\d+$/.test(normalized)) {
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


async function spotifyWebApiRequest(path) {
  var auth = await getSpotifyAuthContext();
  var response = await fetch("https://api.spotify.com/v1" + path, {
    method: "GET",
    headers: {
      "Accept": "application/json",
      "Authorization": "Bearer " + auth.accessToken,
      "User-Agent": SPOTIFY_USER_AGENT
    },
    cf: { cacheTtl: 0 }
  });

  var data;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error("Spotify's catalogue API returned an unreadable response.");
  }
  if (!response.ok) {
    var message = data && data.error && data.error.message;
    throw new Error(message || ("Spotify catalogue request failed (HTTP " + response.status + ")."));
  }
  return data;
}

function spotifySearchItem(type, item) {
  if (!item || !item.id) return null;
  var image = null;
  var artists = [];

  if (type === "track") {
    image = item.album && item.album.images && item.album.images[0] && item.album.images[0].url || null;
    artists = (item.artists || []).map(function(artist) {
      return { id: artist.id || null, name: artist.name || "Unknown artist" };
    });
  } else if (type === "album") {
    image = item.images && item.images[0] && item.images[0].url || null;
    artists = (item.artists || []).map(function(artist) {
      return { id: artist.id || null, name: artist.name || "Unknown artist" };
    });
  } else if (type === "artist") {
    image = item.images && item.images[0] && item.images[0].url || null;
  }

  return {
    type: type,
    id: item.id,
    name: item.name || "Untitled",
    artists: artists,
    image_url: image,
    release_date: item.release_date || (item.album && item.album.release_date) || null,
    album_name: item.album && item.album.name || null,
    spotify_url: "https://open.spotify.com/" + type + "/" + item.id,
    total_tracks: item.total_tracks || null
  };
}

async function spotifySearch(q, type) {
  var cacheKey = q.toLowerCase() + "|" + type;
  var cached = spotifySearchCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  var types = type === "all" ? "track,album,artist" : type;
  var params = new URLSearchParams({
    q: q,
    type: types,
    limit: "6",
    market: "BR"
  });
  var data = await spotifyWebApiRequest("/search?" + params.toString());
  var results = [];

  ["track", "album", "artist"].forEach(function(kind) {
    if (types !== "track,album,artist" && kind !== type) return;
    var bucket = data[kind + "s"];
    var items = bucket && Array.isArray(bucket.items) ? bucket.items : [];
    items.forEach(function(item) {
      var mapped = spotifySearchItem(kind, item);
      if (mapped) results.push(mapped);
    });
  });

  var result = {
    query: q,
    result_type: type,
    results: results,
    source: "Spotify catalogue search",
    observed_at: new Date().toISOString()
  };
  spotifySearchCache.set(cacheKey, { data: result, expiresAt: Date.now() + 300000 });
  if (spotifySearchCache.size > 100) {
    spotifySearchCache.delete(spotifySearchCache.keys().next().value);
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  var results = new Array(items.length);
  var nextIndex = 0;
  var workers = Array.from({ length: Math.min(concurrency, items.length) }, async function() {
    while (true) {
      var index = nextIndex++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function mapSpotifyInternalTrack(track) {
  var id = spotifyEntityId(track && track.uri, "track");
  if (!id) return null;
  var album = track.albumOfTrack || track.album || {};
  var artists = spotifyArtistItems(track);
  var duration = track.duration && track.duration.totalMilliseconds ||
    track.trackDuration && track.trackDuration.totalMilliseconds || null;
  return {
    id: id,
    name: track.name || "Unknown track",
    artists: artists,
    album_name: album.name || null,
    album_id: spotifyEntityId(album.uri, "album") || album.id || null,
    duration_ms: duration,
    spotify_url: "https://open.spotify.com/track/" + id
  };
}

async function spotifyArtistLookup(artistId) {
  var cacheKey = "artist:" + artistId;
  var cached = spotifyEntityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  var data = await fetchSpotifyPathfinder("queryArtistOverview", SPOTIFY_GET_ARTIST_HASH, {
    uri: "spotify:artist:" + artistId,
    locale: "",
    includePrerelease: true
  });
  var artist = data.artistUnion;
  if (!artist || artist.__typename === "NotFound") {
    throw new Error("Spotify could not find that artist.");
  }

  var profile = artist.profile || {};
  var visuals = artist.visuals || {};
  var stats = artist.stats || {};
  var rawTopTracks = artist.discography && artist.discography.topTracks &&
    Array.isArray(artist.discography.topTracks.items)
    ? artist.discography.topTracks.items
    : [];
  var topTracks = rawTopTracks
    .map(function(item) { return mapSpotifyInternalTrack(item.track); })
    .filter(Boolean)
    .slice(0, 10);

  var tracksWithCounts = await mapWithConcurrency(topTracks, 3, async function(track, index) {
    try {
      var count = await fetchSpotifyTrackPlaycount(track.id);
      return Object.assign({}, track, count, {
        rank: index + 1,
        physical_sales: null,
        digital_downloads: null,
        cross_format_score: null
      });
    } catch (error) {
      return Object.assign({}, track, {
        rank: index + 1,
        playcount: null,
        data_status: "unavailable",
        reason: error.message,
        metric: "spotify_lifetime_playcount",
        unit: "plays",
        source: "Spotify Web Player Pathfinder",
        source_type: "unofficial",
        observed_at: new Date().toISOString(),
        physical_sales: null,
        digital_downloads: null,
        cross_format_score: null
      });
    }
  });

  var result = {
    entity_type: "artist",
    artist_id: artistId,
    name: profile.name || "Unknown artist",
    spotify_url: "https://open.spotify.com/artist/" + artistId,
    verified: profile.verified === true,
    followers: stats.followers || null,
    monthly_listeners: stats.monthlyListeners || null,
    image_url: visuals.avatarImage && visuals.avatarImage.sources &&
      visuals.avatarImage.sources[0] && visuals.avatarImage.sources[0].url || null,
    top_tracks_source: "Spotify Web Player artist overview",
    top_tracks_note: "These are the tracks currently listed in Spotify's artist overview, not an official chart or a lifetime-sales ranking.",
    top_tracks: tracksWithCounts,
    cross_format_score: null
  };

  spotifyEntityCache.set(cacheKey, { data: result, expiresAt: Date.now() + 600000 });
  return result;
}

async function spotifyAlbumLookup(albumId) {
  var cacheKey = "album:" + albumId;
  var cached = spotifyEntityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  var album = await spotifyWebApiRequest("/albums/" + encodeURIComponent(albumId) + "?market=BR");
  var result = {
    entity_type: "album",
    album_id: albumId,
    name: album.name || "Unknown album",
    spotify_url: "https://open.spotify.com/album/" + albumId,
    artists: (album.artists || []).map(function(artist) {
      return {
        id: artist.id || null,
        name: artist.name || "Unknown artist",
        spotify_url: artist.id ? "https://open.spotify.com/artist/" + artist.id : null
      };
    }),
    release_date: album.release_date || null,
    release_date_precision: album.release_date_precision || null,
    album_type: album.album_type || null,
    total_tracks: Number.isInteger(album.total_tracks) ? album.total_tracks : null,
    image_url: album.images && album.images[0] && album.images[0].url || null,
    spotify_market: "BR",
    physical_sales: null,
    digital_album_sales: null,
    cross_format_score: null
  };
  spotifyEntityCache.set(cacheKey, { data: result, expiresAt: Date.now() + 600000 });
  return result;
}

async function spotifyEntityLookup(type, id) {
  var cacheKey = type + ":" + id;
  var cached = spotifyEntityCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  if (type === "track") {
    var track = await fetchSpotifyTrackPlaycount(id);
    spotifyEntityCache.set(cacheKey, { data: track, expiresAt: Date.now() + 600000 });
    return track;
  }
  if (type === "album") return spotifyAlbumLookup(id);
  if (type === "artist") return spotifyArtistLookup(id);
  throw new Error("Choose track, album, or artist.");
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

async function handleRequest(request) {
  var url = new URL(request.url);
  var origin = request.headers.get("Origin");

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json({ error: "This origin is not allowed to use the TOTALCHART API." }, 403);
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
      service: "TOTALCHART Spotify lookup API",
      status: "ok",
      providers: ["Spotify catalogue search", "Spotify Web Player Pathfinder"]
    }), origin);
  }

  if (url.pathname === "/api/spotify/search") {
    var query = (url.searchParams.get("q") || "").trim();
    var type = (url.searchParams.get("type") || "all").trim().toLowerCase();
    if (query.length < 2 || query.length > 150) {
      return addCors(json({ error: "Search text must contain between 2 and 150 characters." }, 400), origin);
    }
    if (!["all", "track", "album", "artist"].includes(type)) {
      return addCors(json({ error: "Search type must be all, track, album, or artist." }, 400), origin);
    }
    try {
      var searchResult = await spotifySearch(query, type);
      return addCors(json(searchResult, 200, { "Cache-Control": "public, max-age=60, s-maxage=300" }), origin);
    } catch (error) {
      return addCors(json({ error: "Spotify catalogue search failed.", detail: error.message }, 502), origin);
    }
  }

  if (url.pathname === "/api/spotify/lookup") {
    var entityType = (url.searchParams.get("type") || "").trim().toLowerCase();
    var entityId = (url.searchParams.get("id") || "").trim();
    if (!["track", "album", "artist"].includes(entityType)) {
      return addCors(json({ error: "Entity type must be track, album, or artist." }, 400), origin);
    }
    if (!SPOTIFY_TRACK_ID_RE.test(entityId)) {
      return addCors(json({ error: "A valid 22-character Spotify ID is required." }, 400), origin);
    }
    try {
      var entity = await spotifyEntityLookup(entityType, entityId);
      return addCors(json(entity, 200, { "Cache-Control": "public, max-age=60, s-maxage=600" }), origin);
    } catch (error) {
      return addCors(json({ error: "Spotify " + entityType + " lookup failed.", detail: error.message }, 502), origin);
    }
  }

  if (url.pathname === "/api/spotify/playcount") {
    var spotifyTrackId = (url.searchParams.get("id") || "").trim();
    if (!SPOTIFY_TRACK_ID_RE.test(spotifyTrackId)) {
      return addCors(json({ error: "A valid 22-character Spotify track ID is required." }, 400), origin);
    }
    return addCors(await spotifyPlaycountResponse(spotifyTrackId), origin);
  }

  return addCors(json({ error: "Unknown endpoint." }, 404), origin);
}

addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});
