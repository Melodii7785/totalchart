const ALLOWED_ORIGINS = new Set([
  "https://melodii7785.github.io",
  "http://localhost:5500",
  "http://127.0.0.1:5500",
  "null"
]);

const MUSICBRAINZ_BASE = "https://musicbrainz.org/ws/2/";
const USER_AGENT = "TOTALCHART/0.2.0 (https://github.com/Melodii7785/totalchart)";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders
    }
  });
}

function addCors(response, origin) {
  const headers = new Headers(response.headers);
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
    headers.set("Access-Control-Allow-Headers", "Accept, Content-Type");
    headers.append("Vary", "Origin");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function musicBrainzResponse(targetUrl) {
  let upstream;
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
  } catch {
    return json({ error: "MusicBrainz could not be reached. Please try again later." }, 502);
  }

  const body = await upstream.text();
  if (!upstream.ok) {
    const message = upstream.status === 503
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

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin");

    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return json({ error: "This origin is not allowed to use the TOTALCHART catalogue proxy." }, 403);
    }

    if (request.method === "OPTIONS") {
      return addCors(new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Max-Age": "86400"
        }
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

    let upstreamUrl;

    if (url.pathname === "/api/artists/search") {
      const query = (url.searchParams.get("q") || "").trim();
      if (query.length < 2 || query.length > 150) {
        return addCors(json({ error: "Search text must contain between 2 and 150 characters." }, 400), origin);
      }

      const limit = Math.min(25, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "15", 10) || 15));
      const params = new URLSearchParams({ query, fmt: "json", limit: String(limit) });
      upstreamUrl = MUSICBRAINZ_BASE + "artist?" + params.toString();
    } else {
      const match = url.pathname.match(/^\/api\/artists\/([^/]+)\/recordings$/);
      if (!match) {
        return addCors(json({ error: "Unknown endpoint." }, 404), origin);
      }

      const mbid = match[1];
      if (!UUID_RE.test(mbid)) {
        return addCors(json({ error: "The artist ID must be a valid MusicBrainz UUID." }, 400), origin);
      }

      const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get("limit") || "100", 10) || 100));
      const offset = Math.min(100000, Math.max(0, Number.parseInt(url.searchParams.get("offset") || "0", 10) || 0));
      const params = new URLSearchParams({
        artist: mbid,
        inc: "artist-credits isrcs",
        fmt: "json",
        limit: String(limit),
        offset: String(offset)
      });
      upstreamUrl = MUSICBRAINZ_BASE + "recording?" + params.toString();
    }

    const response = await musicBrainzResponse(upstreamUrl);
    return addCors(response, origin);
  }
};
