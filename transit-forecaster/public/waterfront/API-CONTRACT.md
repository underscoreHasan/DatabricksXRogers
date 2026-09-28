# Frontend forecast API

## Request

`GET /api/forecast?date=2026-10-10`

The only required request field is `date`, a Vancouver calendar date in `YYYY-MM-DD` format, strictly after today. Location is fixed to Waterfront Station in this version. Keep provider credentials and model execution on the server. The browser independently calls the existing same-origin weather, event, and holiday routes so context works before the model is available. Return JSON with HTTP 200 on success and an appropriate non-2xx status on failure.

## Required response

```json
{
  "date": "2026-10-10",
  "timezone": "America/Vancouver",
  "dwellTimeUnit": "minutes",
  "selectedDay": [{ "time": "00:00", "volume": 120, "dwellTime": 18 }],
  "typicalDay": [{ "time": "00:00", "volume": 100, "dwellTime": 16 }],
  "context": { "weather": null, "events": null, "holiday": null, "dayOfWeek": null }
}
```

The excerpt above abbreviates both arrays: **each must contain exactly 48 entries**, ordered `00:00`, `00:30`, …, `23:30`. The frontend keeps a fallback for each missing or invalid volume/dwell field. Valid fields replace their fallback independently. Both real arrays are still required for a fully model-backed display. See `examples/forecast-response.json` for a complete response.

| Field | Meaning |
| --- | --- |
| `date` | Must exactly match the requested calendar date. |
| `timezone` | Exactly `America/Vancouver`; all slot labels are local wall-clock time. |
| `dwellTimeUnit` | Exactly `minutes`. |
| `selectedDay[i].time` | Interval start as `HH:mm`. Index 47 covers 23:30–24:00. |
| `volume` | Nonnegative finite number: model's user-volume measure for this interval. Not automatically concurrent occupancy or unique people across the day. |
| `dwellTime` | Nonnegative finite number: average dwell duration in minutes for the interval. If your model's statistic differs, adapt the UI label. |
| `typicalDay` | The same shape, representing your typical comparable weekday. Define/train that baseline on the server. |
| `context` | Optional downstream API results. Successful independent context requests take precedence. Missing entries render as unavailable. Dates, when present, must match the requested day. |
| `demo` | Boolean set by the server: `DATABRICKS_MODEL_KIND=prototype` marks served prototype values as demo. The default is `trained` for the selected-day endpoint; the typical endpoint is a live Databricks baseline, not a local fallback. |

No confidence bands or causal contribution values are invented. Numeric strings are rejected; normalize them server-side or in `mapBackendResponse`.

The page applies a five-slot moving average to typical volume and simple event/rain boosts to selected volume after receiving this response. Dwell is unchanged. Raw API values remain untouched; see the amounts in README.md.

## Existing downstream response shapes

Pass these objects through as `context.weather`, `.events`, `.holiday`, and `.dayOfWeek`. Shapes were inspected in underscoreHasan/DatabricksXRogers, commit `7abf873796b14db4f61179cb2df3c3298af4e186`. The GET adapter now implements this page contract on top of the POST serving proxy described in `docs/api/API_CONTRACT.md`. It maps `volume_p50` and `dwell_p50` from `waterfront-crowd-forecast` to selected-day values, and prefers the trained response’s `usual_volume` / optional `usual_dwell` for typical-day values. Missing baseline metrics are filled from the medians on `waterfront-crowd-forecast-dummy`; it never overrides valid trained baseline values. `baselineSources.volume` and `.dwell` identify `trained`, `dummy`, or `unavailable`. Each endpoint is validated independently; an unavailable projection is null with a message in `projectionErrors`. Both endpoints failing returns 503. Absent numeric fields are null and use per-metric fallbacks in the page.

### Weather: `/api/weather?date=...`

Fields: `date`, `timezone`, `mode` (`forecast` or `historical_average`), `years_used`, `start_time`, `slot_minutes: 30`, `source_interval_minutes: 60`, `n_slots: 48`, and `weather` (48 slots).

Each weather row has `time` (UTC ISO timestamp), `time_local` (offset ISO timestamp), `rain` (boolean), `temp_c`, `precip_mm`, and `rain_mm` (numbers). Align weather indices to the same local day slots as the model. The UI reads `temp_c`, `rain`, and `mode`. Historical averages are labelled as seasonal estimates. Hourly weather duplicated across two half-hours must not be summed as separate precipitation totals.

### Events: `/api/events?date=...`

```json
{
  "date": "2026-10-10",
  "lookupStatus": "ok",
  "hasHighAttendanceEvent": true,
  "event": {
    "name": "Example event",
    "startTime": "2026-10-11T02:00:00.000Z",
    "endTime": "2026-10-11T05:00:00.000Z",
    "endTimeEstimated": true,
    "size": "large",
    "sourceUrl": "https://www.ticketmaster.ca/"
  }
}
```

`lookupStatus` is `ok`, `partial`, or `unavailable`. `event` can be null; `hasHighAttendanceEvent` can be null. A partial/unavailable lookup is shown as incomplete/unknown, not “no events.” The current repo returns one selected event. UTC event instants are converted to the backend's local UTC−07:00 convention and clipped to the day for chart display. Actual start/end labels remain visible, including previous/next-day ends and estimated-end flags.

### Holiday: `/api/holiday?date=...`

`{"date":"2026-10-10","isHoliday":false}`. Omit/set null if unavailable; do not substitute false after an upstream failure. The existing holiday API supports 2013–2038, so handle dates outside its coverage as unavailable or restrict your server's supported dates explicitly.

### Weekday: `/api/day-of-week?date=...`

`{"date":"2026-10-10","dayOfWeek":"Saturday","dayOfWeekNumber":6}`. Monday=1, Sunday=7. The frontend can derive display labels from the requested calendar date without a separate request.

## Errors and deployment

The model client times out after 80 seconds by default; independent context requests have a 15-second client timeout. A new valid date clears the old projections and context and displays a loading state, without demo curves. Non-2xx responses, invalid JSON, wrong dates, and unsupported units display fallback curves and expose Retry. A missing or malformed volume/dwell field retains only its own fallback while valid fields are used. The legend and status line identify Databricks, demo, and demo fallback sources. The dummy baseline has one fixed weekday profile and one fixed weekend profile. Context and timeline bands update as their requests finish, even if the model fails.

Use same-origin hosting when practical. For authenticated cross-origin APIs, add the required credentials/header policy in `js/api.js` and configure server CORS; do not place secrets in this export.
