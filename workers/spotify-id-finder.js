const ALLOWED_ORIGINS = new Set([
  "https://melodii7785.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500"
]);

const TOKEN_URL = "https://accounts.spotify.com/api/token";
const SEARCH_URL = "https://api.spotify.com/v1/search";
const MARKET = "BR";
const MAX_BODY_BYTES = 6000;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 30;

let tokenCache = null;
let tokenPromise = null;
const resultCache = new Map();
const rateBuckets = new Map();

class HttpError extends Error {
  constructor(status, message, retryAfter) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter || null;
  }
}

function json(data, status, origin, extraHeaders) {
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
    headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
    headers.append("Vary", "Origin");
  }
  if (extraHeaders) {
    Object.keys(extraHeaders).forEach(key => headers.set(key, String(extraHeaders[key])));
  }
  return new Response(JSON.stringify(data), { status, headers });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function bigramDice(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const pairs = new Map();
  for (let i = 0; i < a.length - 1; i += 1) {
    const pair = a.slice(i, i + 2);
    pairs.set(pair, (pairs.get(pair) || 0) + 1);
  }
  let overlap = 0;
  for (let i = 0; i < b.length - 1; i += 1) {
    const pair = b.slice(i, i + 2);
    const count = pairs.get(pair) || 0;
    if (count > 0) {
      overlap += 1;
      pairs.set(pair, count - 1);
    }
  }
  return (2 * overlap) / (a.length + b.length - 2);
}

function similarity(left, right) {
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) {
    return 0.82 + 0.12 * (Math.min(a.length, b.length) / Math.max(a.length, b.length));
  }

  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  let overlap = 0;
  aTokens.forEach(token => {
    if (bTokens.has(token)) overlap += 1;
  });
  const tokenScore = overlap / (aTokens.size + bTokens.size - overlap);
  return Math.max(tokenScore, bigramDice(a, b) * 0.9);
}

function quoteTerm(value) {
  return '"' + String(value || "").replace(/"/g, " ").replace(/\s+/g, " ").trim() + '"';
}

function buildQueries(item) {
  const name = quoteTerm(item.name);
  const artist = item.artist_name ? quoteTerm(item.artist_name) : "";
  const album = item.album_name ? quoteTerm(item.album_name) : "";

  if (item.type === "track") {
    const queries = [];
    if (item.isrc && /^[A-Z0-9]{12}$/i.test(item.isrc)) {
      queries.push("isrc:" + item.isrc.toUpperCase());
    }
    if (artist && album) queries.push("track:" + name + " artist:" + artist + " album:" + album);
    if (artist) queries.push("track:" + name + " artist:" + artist);
    queries.push("track:" + name);
    return Array.from(new Set(queries)).slice(0, 3);
  }

  if (item.type === "album") {
    const queries = [];
    if (artist) queries.push("album:" + name + " artist:" + artist);
    queries.push("album:" + name);
    return Array.from(new Set(queries));
  }

  return ["artist:" + name, name];
}

async function getSpotifyToken(env, forceRefresh) {
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new HttpError(
      503,
      "The Spotify ID Finder is deployed, but its Spotify app credentials have not been configured. Add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET as Worker secrets."
    );
  }

  if (!forceRefresh && tokenCache && tokenCache.expiresAt > Date.now() + 60_000) {
    return tokenCache.token;
  }
  if (tokenPromise) return tokenPromise;

  tokenPromise = (async () => {
    const basic = btoa(env.SPOTIFY_CLIENT_ID + ":" + env.SPOTIFY_CLIENT_SECRET);
    const response = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "Authorization": "Basic " + basic,
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: new URLSearchParams({ grant_type: "client_credentials" })
    });

    let data;
    try {
      data = await response.json();
    } catch {
      throw new HttpError(502, "Spotify's authorization service returned an unreadable response.");
    }

    if (!response.ok || !data.access_token) {
      const message = response.status === 401 || response.status === 400
        ? "Spotify rejected the configured developer app credentials. Check the Client ID and Client Secret."
        : "Spotify could not issue an app access token (HTTP " + response.status + ").";
      throw new HttpError(502, message);
    }

    const expiresIn = Number(data.expires_in) || 3600;
    tokenCache = {
      token: data.access_token,
      expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000
    };
    return tokenCache.token;
  })();

  try {
    return await tokenPromise;
  } finally {
    tokenPromise = null;
  }
}

async function spotifySearch(query, type, env) {
  const cacheKey = type + "|" + query.toLowerCase();
  const cached = resultCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.items;

  async function send(token) {
    const params = new URLSearchParams({
      q: query,
      type,
      limit: "10",
      market: MARKET
    });
    return fetch(SEARCH_URL + "?" + params.toString(), {
      headers: {
        "Authorization": "Bearer " + token,
        "Accept": "application/json"
      }
    });
  }

  let token = await getSpotifyToken(env, false);
  let response = await send(token);
  if (response.status === 401) {
    tokenCache = null;
    token = await getSpotifyToken(env, true);
    response = await send(token);
  }

  if (response.status === 429) {
    throw new HttpError(
      429,
      "Spotify's catalogue search is rate-limited right now. Please try again later.",
      response.headers.get("Retry-After")
    );
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new HttpError(502, "Spotify's catalogue search returned an unreadable response.");
  }

  if (!response.ok) {
    const detail = data && data.error && data.error.message;
    throw new HttpError(502, detail || "Spotify's catalogue search failed (HTTP " + response.status + ").");
  }

  const bucket = data[type + "s"];
  const items = bucket && Array.isArray(bucket.items) ? bucket.items : [];
  resultCache.set(cacheKey, { items, expiresAt: Date.now() + 300_000 });
  if (resultCache.size > 150) {
    resultCache.delete(resultCache.keys().next().value);
  }
  return items;
}

function mapCandidate(type, item) {
  const artists = type === "artist" ? [] : (item.artists || []).map(artist => ({
    id: artist.id || null,
    name: artist.name || "Unknown artist"
  }));
  const album = type === "track" ? item.album : null;

  return {
    type,
    id: item.id,
    name: item.name || "Untitled",
    artists,
    album_name: album && album.name || null,
    release_date: item.release_date || (album && album.release_date) || null,
    duration_ms: type === "track" && Number.isFinite(item.duration_ms) ? item.duration_ms : null,
    image_url: type === "track"
      ? album && album.images && album.images[0] && album.images[0].url || null
      : item.images && item.images[0] && item.images[0].url || null,
    spotify_url: item.external_urls && item.external_urls.spotify ||
      "https://open.spotify.com/" + type + "/" + item.id
  };
}

function scoreCandidate(target, candidate) {
  const nameScore = similarity(target.name, candidate.name);

  if (target.type === "artist") {
    return Math.round(nameScore * 100);
  }

  const candidateArtists = (candidate.artists || []).map(artist => artist.name);
  const artistScore = target.artist_name
    ? Math.max(
        similarity(target.artist_name, candidateArtists.join(" ")),
        ...candidateArtists.map(name => similarity(target.artist_name, name)),
        0
      )
    : null;

  if (target.type === "album") {
    const components = [{ value: nameScore, weight: 0.72 }];
    if (artistScore !== null) components.push({ value: artistScore, weight: 0.23 });

    const targetYear = String(target.release_date || "").slice(0, 4);
    const candidateYear = String(candidate.release_date || "").slice(0, 4);
    if (/^\d{4}$/.test(targetYear) && /^\d{4}$/.test(candidateYear)) {
      components.push({ value: targetYear === candidateYear ? 1 : 0, weight: 0.05 });
    }

    const totalWeight = components.reduce((sum, part) => sum + part.weight, 0);
    return Math.round(100 * components.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight);
  }

  const components = [{ value: nameScore, weight: 0.66 }];
  if (artistScore !== null) components.push({ value: artistScore, weight: 0.29 });

  if (target.album_name && candidate.album_name) {
    components.push({ value: similarity(target.album_name, candidate.album_name), weight: 0.04 });
  }
  if (target.duration_ms && candidate.duration_ms) {
    const difference = Math.abs(target.duration_ms - candidate.duration_ms);
    components.push({ value: Math.max(0, 1 - difference / 15_000), weight: 0.01 });
  }

  const totalWeight = components.reduce((sum, part) => sum + part.weight, 0);
  return Math.round(100 * components.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight);
}

function matchLabel(score) {
  if (score >= 95) return "Very strong";
  if (score >= 88) return "Strong";
  if (score >= 75) return "Possible";
  return "Review carefully";
}

function validateItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new HttpError(400, "A selected iTunes catalogue item is required.");
  }
  if (!["track", "album", "artist"].includes(item.type)) {
    throw new HttpError(400, "Item type must be track, album, or artist.");
  }
  if (typeof item.name !== "string" || !item.name.trim() || item.name.length > 200) {
    throw new HttpError(400, "The selected item must have a valid catalogue name.");
  }

  return {
    type: item.type,
    name: item.name.trim(),
    artist_name: typeof item.artist_name === "string" ? item.artist_name.slice(0, 200).trim() : "",
    album_name: typeof item.album_name === "string" ? item.album_name.slice(0, 200).trim() : "",
    release_date: typeof item.release_date === "string" ? item.release_date.slice(0, 30) : "",
    duration_ms: Number.isFinite(item.duration_ms) ? item.duration_ms : null,
    isrc: typeof item.isrc === "string" ? item.isrc.trim().toUpperCase() : ""
  };
}

async function findMatches(target, env) {
  const queries = buildQueries(target);
  const candidatesById = new Map();

  for (const query of queries) {
    const items = await spotifySearch(query, target.type, env);
    items.forEach(item => {
      const candidate = mapCandidate(target.type, item);
      if (candidate && candidate.id) candidatesById.set(candidate.id, candidate);
    });
  }

  const matches = Array.from(candidatesById.values())
    .map(candidate => {
      const score = scoreCandidate(target, candidate);
      return Object.assign(candidate, {
        match_score: score,
        match_label: matchLabel(score)
      });
    })
    .sort((a, b) => b.match_score - a.match_score)
    .slice(0, 10);

  return {
    type: target.type,
    query: target.name,
    matches,
    source: "Spotify Web API Search",
    market: MARKET,
    searched_at: new Date().toISOString()
  };
}

function checkRateLimit(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const now = Date.now();
  const bucket = rateBuckets.get(ip);

  if (!bucket || now - bucket.startedAt >= RATE_WINDOW_MS) {
    rateBuckets.set(ip, { startedAt: now, count: 1 });
    return true;
  }

  bucket.count += 1;
  return bucket.count <= RATE_MAX_REQUESTS;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "This origin is not allowed to use the TotalChart Spotify ID Finder." }, 403, null);
    }

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": origin || "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS, GET",
          "Access-Control-Allow-Headers": "Accept, Content-Type",
          "Access-Control-Max-Age": "86400",
          "Vary": "Origin"
        }
      });
    }

    if (url.pathname === "/health" && request.method === "GET") {
      return json({
        service: "TotalChart Spotify ID Finder",
        status: "ok",
        configured: Boolean(env.SPOTIFY_CLIENT_ID && env.SPOTIFY_CLIENT_SECRET),
        provider: "Spotify Web API Search"
      }, 200, origin);
    }

    if (url.pathname !== "/resolve") {
      return json({ error: "Unknown endpoint." }, 404, origin);
    }
    if (request.method !== "POST") {
      return json({ error: "Use POST for Spotify ID matching." }, 405, origin, { Allow: "POST, OPTIONS" });
    }
    if (!checkRateLimit(request)) {
      return json({ error: "Too many ID lookups in a short period. Please wait a minute and try again." }, 429, origin, { "Retry-After": "60" });
    }

    const declaredLength = Number(request.headers.get("Content-Length") || 0);
    if (declaredLength > MAX_BODY_BYTES) {
      return json({ error: "The selected catalogue item is too large." }, 413, origin);
    }

    let rawBody;
    try {
      rawBody = await request.text();
      if (rawBody.length > MAX_BODY_BYTES) {
        return json({ error: "The selected catalogue item is too large." }, 413, origin);
      }
    } catch {
      return json({ error: "Could not read the selected catalogue item." }, 400, origin);
    }

    let body;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return json({ error: "The request must contain valid JSON." }, 400, origin);
    }

    try {
      const item = validateItem(body);
      const result = await findMatches(item, env);
      return json(result, 200, origin);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 502;
      const headers = error instanceof HttpError && error.retryAfter
        ? { "Retry-After": error.retryAfter }
        : null;
      return json({
        error: error.message || "Spotify ID matching failed.",
        source: "Spotify Web API Search"
      }, status, origin, headers);
    }
  }
};
