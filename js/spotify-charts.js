const API_BASE = "https://totalchart-musicbrainz-proxy.melodii7785.workers.dev";

export async function fetchGlobalWeeklyChart() {
  let response;
  try {
    response = await fetch(API_BASE + "/api/spotify/global-weekly", {
      headers: { "Accept": "application/json" }
    });
  } catch {
    throw new Error("Could not reach the Spotify Charts connector. Check your connection and try again.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error("Spotify Charts returned an unreadable response.");
  }

  if (!response.ok) {
    throw new Error(payload.error || `Spotify Charts request failed (HTTP ${response.status}).`);
  }

  const view = Array.isArray(payload.chartEntryViewResponses)
    ? payload.chartEntryViewResponses[0]
    : null;
  const rawEntries = view?.entries || (Array.isArray(payload) ? payload : []);

  if (!rawEntries.length) {
    throw new Error("The public Spotify Charts response did not contain a chart. Its undocumented format may have changed.");
  }

  const metadata = view?.chartMetadata || {};
  const entries = rawEntries.map(item => {
    const chartData = item.chartEntryData || {};
    const track = item.trackMetadata || {};
    const rankingMetric = chartData.rankingMetric || null;
    const numericStreams = rankingMetric && rankingMetric.type === "STREAMS"
      ? Number(rankingMetric.value)
      : null;

    return {
      rank: Number.isInteger(chartData.currentRank) ? chartData.currentRank : null,
      previous_rank: Number.isInteger(chartData.previousRank) ? chartData.previousRank : null,
      title: track.trackName || "Untitled recording",
      track_uri: track.trackUri || "",
      artists: Array.isArray(track.artists) ? track.artists : [],
      release_date: track.releaseDate || "",
      chart_date: item.chartDate || "",
      streams: Number.isFinite(numericStreams) && numericStreams >= 0 ? numericStreams : null
    };
  }).filter(item => item.title && item.rank !== null);

  return {
    title: metadata.chartTitle || "Spotify Global Weekly Chart",
    date: rawEntries.find(item => item.chartDate)?.chartDate || metadata.chartDate || "",
    entries,
    retrieved_at: new Date().toISOString()
  };
}

function spotifyId(uri, type) {
  const match = String(uri || "").match(new RegExp("^spotify:" + type + ":([A-Za-z0-9]+)$"));
  return match ? match[1] : "";
}

function fullDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value || "");
}

export function toSpotifyChartRecords(chart) {
  const artists = new Map();
  const recordings = [];
  const observations = [];
  const capturedAt = chart.retrieved_at || new Date().toISOString();
  const chartDate = chart.date || capturedAt.slice(0, 10);
  const source = {
    name: "Spotify Charts public web feed",
    provider: "spotify_charts_public_web",
    type: "official",
    url: "https://charts.spotify.com/charts/view/regional-global-weekly/latest",
    retrieved_at: capturedAt
  };

  chart.entries.forEach(entry => {
    const trackId = spotifyId(entry.track_uri, "track");
    if (!trackId || !entry.artists.length) return;

    const artistRecords = entry.artists.map(artist => {
      const artistId = spotifyId(artist.spotifyUri, "artist");
      if (!artistId) return null;
      const record = {
        id: "sp:" + artistId,
        name: artist.name || "Unknown artist",
        external_ids: { spotify: artistId }
      };
      artists.set(record.id, record);
      return record;
    }).filter(Boolean);

    if (!artistRecords.length) return;
    const recordingId = "sp:" + trackId;
    const recording = {
      id: recordingId,
      title: entry.title,
      artist_id: artistRecords[0].id,
      external_ids: { spotify: trackId }
    };
    if (fullDate(entry.release_date)) recording.release_date = entry.release_date;
    recordings.push(recording);

    if (entry.rank !== null) {
      observations.push({
        id: "spchart-" + chartDate + "-" + trackId + "-rank",
        subject_type: "recording",
        subject_id: recordingId,
        metric: "spotify_chart_position",
        value: entry.rank,
        unit: "position",
        data_status: "reported",
        territory: "WORLD",
        period: { type: "weekly", label: chart.title },
        captured_at: capturedAt,
        source,
        methodology: "Position in the Spotify Global Weekly chart for the reported chart period.",
        notes: "Chart position is not a stream total."
      });
    }

    if (entry.streams !== null) {
      observations.push({
        id: "spchart-" + chartDate + "-" + trackId + "-streams",
        subject_type: "recording",
        subject_id: recordingId,
        metric: "spotify_chart_eligible_streams",
        value: entry.streams,
        unit: "streams",
        data_status: "reported",
        territory: "WORLD",
        period: { type: "weekly", label: chart.title },
        captured_at: capturedAt,
        source,
        methodology: "Spotify Charts stream count for the chart period. Spotify states that chart stream counts are filtered for chart eligibility and may differ from total plays shown in other Spotify surfaces.",
        notes: "Chart-period streams only; not lifetime streams."
      });
    }
  });

  return {
    artists: [...artists.values()],
    recordings,
    observations
  };
}
