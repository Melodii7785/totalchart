const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";
const USER_AGENT_NOTE = "Requests are sent through the TOTALCHART proxy with an application User-Agent.";
const REQUEST_INTERVAL_MS = 1100;

let requestQueue = Promise.resolve();
let lastRequestAt = 0;

function requestJson(path) {
  const task = requestQueue.then(async () => {
    const wait = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
    if (wait) await new Promise(resolve => setTimeout(resolve, wait));
    lastRequestAt = Date.now();

    let response;
    try {
      response = await fetch(API_BASE + path, {
        method: "GET",
        headers: { "Accept": "application/json" }
      });
    } catch {
      throw new Error("Could not reach the TOTALCHART catalogue service. Check your connection and try again.");
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error("The catalogue service returned an unreadable response.");
    }

    if (!response.ok) {
      throw new Error(data.error || `Catalogue request failed (HTTP ${response.status}).`);
    }
    return data;
  });

  requestQueue = task.catch(() => {});
  return task;
}

export async function searchArtists(query, limit = 15) {
  const clean = String(query || "").trim();
  if (clean.length < 2) throw new Error("Enter at least two characters.");
  if (clean.length > 150) throw new Error("Search text is too long.");
  return requestJson("/api/artists/search?q=" + encodeURIComponent(clean) + "&limit=" + limit);
}

export async function browseRecordings(artistMbid, limit = 100, offset = 0) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(artistMbid)) {
    throw new Error("That artist does not have a valid MusicBrainz ID.");
  }
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  return requestJson("/api/artists/" + artistMbid + "/recordings?" + params.toString());
}

export function toArtistRecord(artist) {
  return {
    id: "mb:" + artist.id,
    name: artist.name,
    ...(artist["sort-name"] ? { sort_name: artist["sort-name"] } : {}),
    ...(artist.disambiguation ? { disambiguation: artist.disambiguation } : {}),
    external_ids: { musicbrainz: artist.id }
  };
}

export function toRecordingRecord(recording, artist) {
  const record = {
    id: "mb:" + recording.id,
    title: recording.title,
    artist_id: "mb:" + artist.id,
    external_ids: { musicbrainz: recording.id }
  };

  if (Number.isInteger(recording.length) && recording.length >= 0) {
    record.duration_ms = recording.length;
  }
  if (Array.isArray(recording.isrcs) && recording.isrcs.length) {
    record.isrc = recording.isrcs[0];
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(recording["first-release-date"] || "")) {
    record.release_date = recording["first-release-date"];
  }
  return record;
}

export const musicBrainzSource = {
  name: "MusicBrainz",
  provider: "musicbrainz",
  type: "third_party",
  url: "https://musicbrainz.org/"
};

export { USER_AGENT_NOTE };
