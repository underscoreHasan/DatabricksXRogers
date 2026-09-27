# Transit Forecaster

Minimal hackathon starter: React frontend, Next.js API, TypeScript.

## Run

Use Node.js 24 and npm. From this directory:

```sh
npm ci
npm run dev
```

Open [localhost:3000](http://localhost:3000). **Check backend** calls `GET /api/health`.

- `app/page.tsx` — frontend
- `app/api/health/route.ts` — backend
- `app/globals.css` — styles

Production: `npm run build`, then `npm start`.

## Downtown event API

Copy `.env.example` to `.env.local`, set `TICKETMASTER_API_KEY` to your Ticketmaster **consumerKey**, and restart the server. Keep it server-side; no `NEXT_PUBLIC_` prefix, consumerSecret, or OAuth callback is needed. Existing `.env.local` files should be edited, not overwritten. Obtain a key from the [Ticketmaster developer portal](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/).

```sh
curl 'http://localhost:3000/api/events?date=2026-10-10'
```

The only input is a real `YYYY-MM-DD` date, including dates before today. Missing, repeated, or impossible dates return 400. Ticketmaster Discovery may drop listings after they expire, so a past date can come back with no event even when one happened.

```json
{
  "date": "2026-10-10",
  "lookupStatus": "ok",
  "hasHighAttendanceEvent": true,
  "event": {
    "name": "Example event",
    "startTime": "2026-10-11T02:00:00.000Z",
    "endTime": "2026-10-11T07:00:00.000Z",
    "endTimeEstimated": true,
    "size": "large",
    "sourceUrl": "https://www.ticketmaster.ca/..."
  }
}
```

The example is illustrative. Results contain one event, selected by size, configured venue priority, earliest start, then event ID. Any genuine event genre qualifies at an eligible venue; canceled/postponed, uncertain-time, test and ancillary listings are excluded. Previous-night events can qualify when their interval overlaps the requested day.

| Size | Eligible venues | Estimated duration when no confirmed end exists |
| --- | --- | --- |
| large | BC Place, Rogers Arena | 5 hours |
| medium | Queen Elizabeth Theatre, Orpheum, Harbour Event & Convention Centre, Vogue Theatre, Commodore Ballroom | 4 hours |
| small | Vancouver Playhouse, The Pearl, Rickshaw Theatre, Fortune Sound Club | 3 hours |

Tune these assumptions in `lib/event-policy.ts`. Size is a venue-based policy label, not measured attendance. Durations are event-interval proxies, not validated traffic-spike lengths. A usable published end time takes priority and sets `endTimeEstimated` to false.

`hasHighAttendanceEvent` is true for a verified medium/large event. A complete lookup with only a small event or no match returns false; no match also returns `event: null`. Missing coverage or interrupted pagination produces `lookupStatus: "partial"` (HTTP 200), with a null flag unless a verified medium/large match establishes true. Total provider failure or a missing key returns 503, `lookupStatus: "unavailable"`, and a null flag. Treat null as unknown, not as false.

A negative result means no qualifying event in these venues within the checked Ticketmaster catalog. Free civic events, independently ticketed gatherings, and other venues can be missing. Previous-day expired listings may also disappear from the provider. Multi-day listings describe their published interval, not continuous attendance.

Lookups fetch at most five pages of 100 within ten seconds, with no retries. Complete results are cached for 15 minutes, up to 128 dates per server process; simultaneous requests for the same date share one lookup. Partial results and failures are not cached. This in-memory cache is intentionally simple and is not shared between deployed instances.

## Day-of-week API

```sh
curl 'http://localhost:3000/api/day-of-week?date=2026-10-10'
```

```json
{
  "date": "2026-10-10",
  "dayOfWeek": "Saturday",
  "dayOfWeekNumber": 6
}
```

`dayOfWeekNumber` uses Monday = 1 through Sunday = 7. Supply the local calendar date as `YYYY-MM-DD`; the calculation does not shift that date into another timezone. Past and future dates are supported for training and forecasting. Missing, repeated, malformed, or impossible dates return HTTP 400. This endpoint computes locally and needs no API key or external request.

## Weather API

No API key or new environment variables are required. Location is fixed to the Waterfront area of downtown Vancouver (49.286, -123.111). The only input is one real `YYYY-MM-DD` date, today or later in Vancouver.

```sh
curl 'http://localhost:3000/api/weather?date=2026-09-27'
curl 'http://localhost:3000/api/weather?date=2027-06-30'
```

- **Today through 15 days ahead:** one [Open-Meteo forecast](https://open-meteo.com/en/docs) request supplies the requested day's weather.
- **Beyond that window:** three parallel [historical weather](https://open-meteo.com/en/docs/historical-weather-api) requests supply the same month/day and Vancouver local hour from the last three completed calendar years. Each numeric field is averaged across those years. The year count is hardcoded to `HISTORY_YEARS = 3` in `lib/weather.ts`; there is no surrounding-day averaging or checkbox input.

Both modes return the same shape. Example values below are illustrative; only the first two of 48 entries are shown:

```json
{
  "date": "2027-06-30",
  "timezone": "America/Vancouver",
  "mode": "historical_average",
  "years_used": [2023, 2024, 2025],
  "start_time": "2027-06-30T07:00:00.000Z",
  "slot_minutes": 30,
  "source_interval_minutes": 60,
  "n_slots": 48,
  "weather": [
    { "time": "2027-06-30T07:00:00.000Z", "time_local": "2027-06-30T00:00:00-07:00", "rain": true, "temp_c": 15.8, "precip_mm": 0.3, "rain_mm": 0.3 },
    { "time": "2027-06-30T07:30:00.000Z", "time_local": "2027-06-30T00:30:00-07:00", "rain": true, "temp_c": 15.8, "precip_mm": 0.3, "rain_mm": 0.3 }
  ]
}
```

Forecast responses use `mode: "forecast"` and `years_used: []`. `temp_c` is Celsius, `precip_mm` includes all precipitation (including snow's water equivalent), and `rain_mm` is liquid rainfall including showers. Forecast rainfall uses `rain + showers`; archive `rain` already includes showers. `rain` is `rain_mm > 0`, evaluated after historical averaging. A true historical flag indicates a nonzero average; it is not a probability or majority vote.

**Each hourly reading is repeated at :00 and :30.** `precip_mm` and `rain_mm` retain the provider's preceding-hour totals. They are not separate 30-minute accumulation amounts and must not be summed across duplicated rows. These conversion rules and coordinates must match the Databricks preparation code; that alignment has not yet been verified. Historical averages are seasonal estimates, not forecasts of a specific future day's weather.

`time` is UTC for model integration; `time_local` includes Vancouver's UTC offset. Vancouver stays on UTC-7 after [March 8, 2026](https://news.gov.bc.ca/releases/2026AG0013-000209), so future days contain 48 rows. Historical averaging preserves the older timezone rules: repeated autumn hours are averaged within each year before averaging years; a spring hour that never occurred uses the other years' readings. February 29 maps to February 28 only in non-leap reference years.

Invalid, repeated, past dates or additional parameters (including the old `rain` and `n_years`) return **400**. Provider failures, timeouts, or missing required readings return **503**, with no fabricated values or silent switch of source. The former 422 checkbox response is removed.

Complete provider responses are cached for 15 minutes (forecast) or 24 hours (archive), up to 64 responses per server process. Requests share a ten-second deadline with no retries.

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests use Node 24's built-in runner and mocked provider HTTP responses; no live key is needed.
