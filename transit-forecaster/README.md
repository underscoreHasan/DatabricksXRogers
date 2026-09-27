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

The only input is a real `YYYY-MM-DD` date, today or later in `America/Vancouver`. Missing, repeated, impossible, or past dates return 400. This endpoint is for forecasts; Discovery is not a historical training-data archive.

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

## Checks

```sh
npm test
npm run lint
npm run build
```

Tests use Node 24's built-in runner and mocked provider HTTP responses; no live key is needed.
