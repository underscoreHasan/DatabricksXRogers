# Downtown Vancouver event API

Status: implemented and verified on 2026-09-26.

## Purpose and agreed scope

Given a date, return one main downtown Vancouver event to supply fixed-size prediction features and an event name/source for the forecast explanation. Use Ticketmaster Discovery API only. Size is an explicitly documented venue-based heuristic, not measured attendance. Keep the existing Next.js app and avoid a database, background jobs, search/LLM integration, or new UI.

## Date scope

Version 1 supports today and future dates in America/Vancouver. Historical training-data backfill is outside this version because the current Ticketmaster catalog is not a verified historical archive. The v1 implementation uses this forecast-only date scope.

## HTTP contract

GET /api/events?date=YYYY-MM-DD

Date is the only input. Reject missing, repeated, malformed, impossible, or past dates with HTTP 400 and a short JSON error. The area is fixed to downtown Vancouver, including the approved Chinatown and Downtown Eastside venues.

Successful and partial responses use this shape:

```ts
type EventLookup = {
  date: string;
  lookupStatus: "ok" | "partial" | "unavailable";
  hasHighAttendanceEvent: boolean | null;
  event: {
    name: string;
    startTime: string;
    endTime: string;
    endTimeEstimated: boolean;
    size: "small" | "medium" | "large";
    sourceUrl: string;
  } | null;
};
```

Times are ISO 8601 timestamps with an explicit offset or UTC Z. Only admit events with a confirmed start time. Prefer a valid, confirmed provider end time strictly after the start, with endTimeEstimated: false. When it is missing, invalid, not after the start, approximate, or marked no-specific-time, estimate it with the duration map below and set endTimeEstimated: true. Do not substitute ticket sale deadlines or doors-open times. A returned event therefore always has an endTime; no match still returns event: null.

Return the highest-ranked verified event, including a small event if that is the best result. hasHighAttendanceEvent is true for medium/large, false for small/no match after a complete lookup, and null when incomplete lookup prevents a negative conclusion. Thus a small event may accompany false. A verified medium/large event is enough for true even if lookupStatus is partial; it may not be the largest event on that date.

An empty successful result is event: null and hasHighAttendanceEvent: false. This means no qualifying event was found within the supported catalog and venues, not proof that nothing is happening downtown. Complete provider failure returns HTTP 503, lookupStatus: unavailable, event: null, and hasHighAttendanceEvent: null. Partial results return HTTP 200 with lookupStatus: partial.

## Discovery and confidence rules

Use the server-side TICKETMASTER_API_KEY and Ticketmaster Discovery v2 events search. Query Vancouver, BC, Canada, with a local date-overlap range covering the previous local day and the requested day so late previous-day events with estimated ends can be considered. Validate returned venue and date information locally. After resolving the confirmed or heuristic end time, retain only events whose interval overlaps the requested local day: start < next local midnight and end > local midnight. Query expansion is only candidate discovery and does not guarantee the provider retains all previous-day events. Multi-day listings describe the published interval, not verified continuous attendance or daily opening hours.

Only admit physical events at the approved venues below, matched by exact normalized venue name/explicit aliases and Vancouver, BC, Canada. Discover and verify stable Ticketmaster venue IDs during the first live coverage check; do not invent them. Other venues are outside v1 coverage, even if they are downtown.

Require a confirmed date/start time and a public event URL. Reject canceled, postponed, TBA/TBD, or unknown-status events. Accept onsale, offsale, and rescheduled events only at their currently confirmed date. Exclude parking, merchandise, suite rentals, VIP upgrades, and other add-ons using provider classifications and narrowly scoped title rules. Avoid broad title substring rules that can exclude real performances.

Do not filter by event genre or require separate comedy, dance, family, sports, or music categories. Any genuine in-person event at an approved venue qualifies if it passes the date, status, and add-on checks.

Deduplicate by provider event ID and equivalent title/venue/start-time records before selecting one result. Provider ranking/popularity is not treated as attendance evidence.

## Size and deterministic selection

These are application policy labels, not capacity measurements or numerical attendance thresholds:

| Venue | Estimated size |
| --- | --- |
| BC Place / BC Place Stadium; Rogers Arena | large |
| Queen Elizabeth Theatre; Orpheum / Orpheum Theatre; Harbour Event & Convention Centre; Vogue Theatre; Commodore Ballroom | medium |
| Vancouver Playhouse; Rickshaw Theatre; The Pearl; Fortune Sound Club | small |

Harbour aliases must distinguish the event venue on Pacific Boulevard from Harbour Centre and Vancouver Convention Centre. The Pearl and Fortune small labels are provisional application defaults rather than verified capacity measurements. All labels apply to genuine events regardless of genre.

Unrecognized venues are excluded rather than assigned an invented size. In this version, high attendance means medium or large under this policy. This is a model input heuristic, not proof of actual attendance or traffic impact.

Select large before medium before small. Within a size tier, use this explicit venue priority: BC Place, Rogers Arena, Queen Elizabeth Theatre, Orpheum, Harbour Event & Convention Centre, Vogue Theatre, Commodore Ballroom, Vancouver Playhouse, The Pearl, Rickshaw Theatre, Fortune Sound Club. Then choose earliest start time, then provider event ID. This tie-break is a deterministic approximation, not a numeric crowd estimate.

## Missing end-time heuristic

| Size | Fallback duration from confirmed start |
| --- | --- |
| small | 3 hours |
| medium | 4 hours |
| large | 5 hours |

Compute endTime as startTime plus the duration in elapsed hours, allowing the date to roll over. Keep these values together with the venue rules so they are easy to tune. Use them only when a usable confirmed provider end is unavailable. The model can use endTimeEstimated to distinguish imputed timing from published timing.

These are initial modeling assumptions, not measured event durations or validated traffic-spike lengths. An event's schedule and its traffic impact window are different: arrivals may precede the start and departures may follow the end. This version supplies a consistent event interval proxy; learning or adding traffic-specific lead/lag windows is outside this change. Size alone does not establish actual duration.

## Provider fields and derived values

| Output or validation need | Source |
| --- | --- |
| date | Validated request input |
| name | Event name |
| startTime | dates.start.dateTime; reject TBA/TBD/no-specific-time or absent start |
| endTime | Valid, confirmed dates.end.dateTime after start; otherwise start plus the size-based duration |
| endTimeEstimated | false for a usable confirmed provider end; true for the heuristic fallback |
| sourceUrl | Event url |
| Venue identity/location | Embedded venue id/name, city/state/country, with coordinates available for verification |
| Cancellation/postponement | dates.status.code |
| size | Our approved venue-to-size map; not supplied by Discovery |
| hasHighAttendanceEvent | Derived from verified matches, size policy, and lookup completeness |
| lookupStatus | Derived from provider request and parsing outcomes |

A documented field is not guaranteed to be populated on every event. In particular, Discovery alone cannot promise an exact end time, so the duration fallback fills that field and labels it estimated. Venue capacity, actual attendance, and expected attendance are not documented Discovery fields. An authenticated sample on 2026-09-26 confirmed venue/date/status/source fields and both absent and populated provider ends; completeness still varies by listing.

## Request handling

Fetch pages sequentially with 100 results per page, at most five pages, and a ten-second total upstream time budget. Keep pagination under Ticketmaster's documented deep-paging limit. More pages, malformed candidate records, or failure after a usable page produce partial status; they never silently imply an exhaustive negative result. No automatic retries in v1. A server-side 15-minute successful-response cache limits repeated identical lookups; failures are not cached.

The key stays in transit-forecaster/.env.local. Provide a tracked .env.example with an empty placeholder and update the existing ignore rule to allow it. Never return the key or credential-bearing request URL in logs/errors. Missing configuration returns a descriptive HTTP 503 error without calling Ticketmaster.

## Implementation boundaries and validation

Keep the HTTP handler in app/api/events/route.ts, provider access and normalization in lib/ticketmaster.ts, and venue/size rules in a small configuration module. Keep the existing health route and frontend unchanged.

Use mocked provider responses to verify valid/invalid dates, Vancouver day boundaries, cross-midnight overlap, venue filtering and genre-independent eligibility, add-on exclusion, cancellation and uncertain times, all three fallback durations, preference for confirmed ends, missing/invalid/approximate ends and the estimate flag, estimated midnight rollover, duplicate records, deterministic selection, no-match results, pagination, partial failure, missing configuration, and rate-limit/timeout failures. Run the app's lint and production build. Once the user supplies a key locally, verify known major-venue dates against live Ticketmaster responses before claiming live coverage.

## Developer setup and coverage

Create a developer account at https://developer-account.ticketmaster.com/user/register, complete the account activation steps, and obtain a Discovery API key from the signed-in portal. Store it locally as TICKETMASTER_API_KEY in transit-forecaster/.env.local. Discovery uses the API key query parameter; no customer OAuth flow is required for event search.

Ticketmaster is a source for ticketed music, sports, theatre/performing arts, comedy, festivals, and family attractions through its supported ticketing platforms. Coverage for specific venues and dates still requires live validation. Free civic events, demonstrations, independently ticketed conferences, community gatherings, private events, and other non-ticketed traffic drivers may be absent. These are expected coverage risks inferred from a ticketing catalog, not guarantees that every event in those categories is missing.

The venue allowlist further narrows coverage intentionally. A negative response must be explained as no qualifying event found in the checked Ticketmaster coverage, not no downtown event or no expected traffic disruption. Convention Centre listings and web search are possible future sources, outside this version.

## Source

[Ticketmaster Discovery API documentation](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) documents authentication, query filters, event fields, status flags, pagination, and quotas. Discovery does not document an expected-attendance field; all size rules above are application policy.

## Live verification (2026-09-26)

The production-built endpoint returned HTTP 200 with complete lookups for 2026-09-26 (Vancouver Whitecaps FC vs. D.C. United at BC Place) and 2026-10-10 (NBA Canada Series - Toronto Raptors v LA Clippers at Rogers Arena). Both were large with estimated five-hour ends. Invalid input returned 400; the existing health endpoint returned 200. All 46 tests, lint, and production build passed.

Observed Vancouver/BC/CA venue IDs include BC Place `KovZpZAJdn6A`, Rogers Arena `KovZpZAFFInA`, Queen Elizabeth Theatre `KovZpZAavEvA`, Orpheum Theatre `KovZpZAaevlA`, Commodore Ballroom `KovZpZAEkklA`, Vogue Theatre `KovZpZAkEenA` / Vogue Theatre-BC `ZFr9jZea7e`, The Pearl `KovZpZAaedJA` / `rZ7HnEZafK3`, Rickshaw Theatre `KovZpZAavtnA`, and Fortune Sound Club `KovZpZAavneA` / `rZ7HnEZaooc` / `ZFr9jZaa6v`. Names and addresses in the authenticated sample establish the Vogue alias. Venue IDs vary across ticketing sources, so exact normalized names and location remain the eligibility rule. Harbour and Vancouver Playhouse were not observed in this sample; their live coverage remains unverified.
