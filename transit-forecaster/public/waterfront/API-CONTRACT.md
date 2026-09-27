# Placeholder forecast API

## Request

`GET /api/forecast?date=2026-10-10`

The only required request field is `date`, a Vancouver calendar date in `YYYY-MM-DD` format, strictly after today. Location is fixed to Waterfront Station in this version. Do not require the browser to fetch downstream features or hold API keys. Return JSON with HTTP 200 on success and an appropriate non-2xx status on failure.

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

The excerpt above abbreviates both arrays: **each must contain exactly 48 entries**, ordered `00:00`, `00:30`, …, `23:30`. The frontend rejects shortened arrays. See `examples/forecast-response.json` for a complete response.

| Field | Meaning |
| --- | --- |
| `date` | Must exactly match the requested calendar date. |
| `timezone` | Exactly `America/Vancouver`; all slot labels are local wall-clock time. |
| `dwellTimeUnit` | Exactly `minutes`. |
| `selectedDay[i].time` | Interval start as `HH:mm`. Index 47 covers 23:30–24:00. |
| `volume` | Nonnegative finite number: model's user-volume measure for this interval. Not automatically concurrent occupancy or unique people across the day. |
| `dwellTime` | Nonnegative finite number: average dwell duration in minutes for the interval. If your model's statistic differs, adapt the UI label. |
| `typicalDay` | The same shape, representing your typical comparable weekday. Define/train that baseline on the server. |
| `context` | Optional downstream API results. Missing entries render as unavailable. Dates, when present, must match the requested day. |
| `demo` | Optional boolean. Only set `true` for illustrative data; the UI displays a demo banner. |

No confidence bands or causal contribution values are invented. Numeric strings are rejected; normalize them server-side or in `mapBackendResponse`.

## Existing downstream response shapes

Pass these objects through as `context.weather`, `.events`, `.holiday`, and `.dayOfWeek`. Shapes were inspected in underscoreHasan/DatabricksXRogers, commit `7abf873796b14db4f61179cb2df3c3298af4e186`. The combined `/api/forecast` endpoint is a proposed integration contract, not an existing route verified in that repo.

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

The client times out after 30 seconds by default. Non-2xx responses, invalid JSON, wrong response dates, unsupported units and invalid projections display an error with Retry. Loading clears old projections so a failed new date cannot masquerade as old data.

Use same-origin hosting when practical. For authenticated cross-origin APIs, add the required credentials/header policy in `js/api.js` and configure server CORS; do not place secrets in this export.
