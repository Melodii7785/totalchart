# TOTALCHART data layer

This directory contains the canonical, provider-independent data format.

## Files

- `schema.json` — JSON Schema for the dataset.
- `observations.json` — the current dataset, initially empty.

## Design rules

1. **Providers supply evidence, not the database format.** A provider adapter must convert its response into this schema.
2. **Every statistic is an observation.** Keep the source, capture time, territory, period, unit, and reporting status attached to the value.
3. **Never turn missing data into zero.** If a value is unknown, do not create an observation for it. The interface can display “Unavailable” or “Not researched” separately.
4. **Do not silently combine unlike units.** Streams, views, physical copies, downloads, chart positions, and certifications remain distinct metrics.
5. **Keep reported, estimated, and derived values distinguishable.** Derived values must explain their calculation in `methodology`.
6. **Preserve provenance.** Do not overwrite an old observation when a new snapshot arrives; append a new observation with its own ID and capture date.
7. **Keep identity separate from measurements.** Artists and recordings are catalogue entities. Their existence does not imply that TOTALCHART has verified performance data.

## Metric key examples

- `spotify_streams` — Spotify stream count.
- `spotify_daily_streams` — streams during a daily period.
- `youtube_views` — YouTube view count.
- `physical_sales` — reported physical units.
- `digital_downloads` — paid digital downloads.
- `chart_position` — position on a named chart (put chart name and source details in notes/methodology).

The schema intentionally does not require a specific music provider. MusicBrainz IDs, Spotify IDs, ISRCs, and other identifiers belong in `external_ids`; they are not interchangeable with TOTALCHART's own record IDs.

## Example observation

```json
{
  "id": "obs-example-001",
  "subject_type": "recording",
  "subject_id": "recording-example-001",
  "metric": "spotify_streams",
  "value": 123456,
  "unit": "streams",
  "data_status": "reported",
  "territory": "WORLD",
  "period": { "type": "lifetime" },
  "captured_at": "2026-11-20T12:00:00Z",
  "source": {
    "name": "Example source",
    "provider": "example-provider",
    "type": "third_party",
    "url": "https://example.com/data",
    "retrieved_at": "2026-11-20T12:00:00Z"
  },
  "notes": "Illustrative example only; not a real statistic."
}
```

The example is documentation, not a real entry in `observations.json`.
