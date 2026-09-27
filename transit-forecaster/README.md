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

## Holiday API

```sh
curl 'http://localhost:3000/api/holiday?date=2027-07-01'
```

```json
{ "date": "2027-07-01", "isHoliday": true }
```

Checks B.C. statutory holiday calendar dates for Vancouver using the free [Canada Holidays API](https://canada-holidays.ca/api). No API key, environment variables, or new dependencies are needed. It requests the supplied date's year, so upcoming years work without maintaining a yearly list. The provider supports 2013 through 2038.

Supply one local calendar date as `YYYY-MM-DD`. Ordinary days return `isHoliday: false`. Optional holidays (including Easter Monday and Boxing Day) and substitute/observed days off are excluded; Christmas 2027 is true on December 25 and false on December 27. This is a holiday-date flag, not an employer or transit operating schedule.

Missing, repeated, malformed, impossible, or out-of-range dates return 400. Provider failures return 503 with an error, never a misleading false. Yearly provider responses use Next.js's 24-hour fetch cache and a five-second timeout.

## Weather API

No API key or new environment variables are required. Weather is fixed to the Waterfront area of downtown Vancouver (49.286, -123.111).

```sh
# Automatic forecast: use a date from today through 15 days ahead.
curl 'http://localhost:3000/api/weather?date=2026-09-27'

# Simulation: checked checkbox = true, unchecked = false.
curl 'http://localhost:3000/api/weather?date=2027-06-30&rain=true'
```

Supply one real `YYYY-MM-DD` date, today or later in Vancouver. Without `rain`, the endpoint makes one [Open-Meteo forecast](https://open-meteo.com/en/docs) request covering the 16-day window, then selects the requested day. A date outside that window, or incomplete forecast readings, returns **422** with `requires_rain_choice: true`: show the rain checkbox and resubmit with an explicit `rain=true` or `rain=false`. Either value explicitly selects simulation, including within the forecast window. Invalid or repeated parameters return 400; provider failures and timeouts return 503.

Successful responses have this shape (weather array shortened):

```json
{
  "date": "2027-06-30",
  "mode": "simulation",
  "temperature_source": "historical_average",
  "start_time": "2027-06-30T07:00:00.000Z",
  "n_slots": 48,
  "slot_minutes": 30,
  "weather": [
    { "time": "2027-06-30T07:00:00.000Z", "rain": true, "temp_c": 16.2 },
    { "time": "2027-06-30T07:30:00.000Z", "rain": true, "temp_c": 16.2 }
  ]
}
```

Forecast responses use `mode: "forecast"` and `temperature_source: "forecast"`. Simulation uses the selected rain flag for every slot. Temperature is a seasonal estimate: three parallel [historical weather](https://open-meteo.com/en/docs/historical-weather-api) requests for the last three completed calendar years, using the target month/day plus or minus seven days. Readings are averaged by Vancouver local hour and rounded to 0.1°C. Windows are clipped to each reference year; February 29 maps to February 28 in non-leap years. This is a scenario, not a long-range weather forecast.

Each hourly temperature and rain flag is repeated for its two half-hour slots. Forecast rain means hourly `rain + showers > 0` mm; snow alone does not set rain. Open-Meteo rainfall describes the preceding hour, so this flag is an hourly proxy. These are explicit defaults, **not yet verified against the Databricks preparation code**: training must use the same coordinates, rainfall rule, units, and hourly-to-half-hour conversion. Adjust `lib/weather.ts` if training differs.

The `weather` entries match the planned model fields: `{time, rain, temp_c}`. Times are UTC instants for the selected Vancouver calendar day. Vancouver stays on UTC-7 after [March 8, 2026](https://news.gov.bc.ca/releases/2026AG0013-000209), so future days have 48 slots. The endpoint explicitly applies this rule even on older Node/provider timezone data, while preserving historical offsets when averaging past temperatures. Historical transition-day handling can produce 46 or 50 slots; any 50-slot response would need splitting for the model plan's 48-slot limit. The forecast/model orchestration and frontend checkbox are not part of this endpoint.

Forecast responses are cached for 15 minutes and historical responses for 24 hours (up to 64 provider responses per server process). Changing the rain checkbox reuses cached temperatures. Requests have a shared ten-second deadline with no retries. Missing temperatures or rain readings are never replaced with zero or dry weather.

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests use Node 24's built-in runner and mocked provider HTTP responses; no live key is needed.
