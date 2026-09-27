# Downtown Vancouver event API

Status: proposed design for review; implementation has not started.

## Purpose and agreed scope

Given a date, return one main downtown Vancouver event to supply fixed-size prediction features and an event name/source for the forecast explanation. Use Ticketmaster Discovery API only. Size is an explicitly documented venue/event-type heuristic, not measured attendance. Keep the existing Next.js app and avoid a database, background jobs, search/LLM integration, or new UI.

## Proposed date scope

Version 1 supports today and future dates in America/Vancouver. Historical training-data backfill is outside this version because the current Ticketmaster catalog is not a verified historical archive. This date restriction is a proposed assumption for review, not a previously confirmed requirement.

## HTTP contract

GET /api/events?date=YYYY-MM-DD

Date is the only input. Reject missing, repeated, malformed, impossible, or past dates with HTTP 400 and a short JSON error. The area is fixed to downtown Vancouver.

Successful and partial responses use this shape:

```ts
type EventLookup = {
  date: string;
  lookupStatus: "ok" | "partial" | "unavailable";
  hasHighAttendanceEvent: boolean | null;
  event: {
    name: string;
    startTime: string;
    endTime: string | null;
    size: "small" | "medium" | "large";
    sourceUrl: string;
  } | null;
};
```

Times are ISO 8601 timestamps with an explicit offset or UTC Z. Only admit events with a confirmed start time. Return a confirmed end time when supplied; otherwise null, including when the provider marks it approximate. Do not substitute ticket sale deadlines, doors-open times, or an invented duration.

Return the highest-ranked verified event, including a small event if that is the best result. hasHighAttendanceEvent is true for medium/large, false for small/no match after a complete lookup, and null when incomplete lookup prevents a negative conclusion. Thus a small event may accompany false. A verified medium/large event is enough for true even if lookupStatus is partial; it may not be the largest event on that date.

An empty successful result is event: null and hasHighAttendanceEvent: false. This means no qualifying event was found within the supported catalog and venues, not proof that nothing is happening downtown. Complete provider failure returns HTTP 503, lookupStatus: unavailable, event: null, and hasHighAttendanceEvent: null. Partial results return HTTP 200 with lookupStatus: partial.

## Discovery and confidence rules

Use the server-side TICKETMASTER_API_KEY and Ticketmaster Discovery v2 events search. Query Vancouver, BC, Canada, with a local date-overlap range. Validate returned venue and date information locally. Include a cross-midnight or multi-day event only when its confirmed interval overlaps the requested local day; when end time is missing, require its local start date to match the requested date. Multi-day listings describe the published interval, not verified continuous attendance or daily opening hours.

Only admit physical events at the approved venues below, matched by exact normalized venue name/explicit aliases and Vancouver, BC, Canada. Discover and verify stable Ticketmaster venue IDs during the first live coverage check; do not invent them. Other venues are outside v1 coverage, even if they are downtown.

Require a confirmed date/start time and a public event URL. Reject canceled, postponed, TBA/TBD, or unknown-status events. Accept onsale, offsale, and rescheduled events only at their currently confirmed date. Exclude parking, merchandise, suite rentals, VIP upgrades, and other add-ons using provider classifications and narrowly scoped title rules. Avoid broad title substring rules that can exclude real performances.

Deduplicate by provider event ID and equivalent title/venue/start-time records before selecting one result. Provider ranking/popularity is not treated as attendance evidence.

## Size and deterministic selection

These are proposed policy labels, not capacity measurements or numerical attendance thresholds:

| Venue | Eligible event type | Estimated size |
| --- | --- | --- |
| BC Place / BC Place Stadium | Sports or concerts | large |
| Rogers Arena | Sports or concerts | large |
| Queen Elizabeth Theatre, Orpheum / Orpheum Theatre, Vogue Theatre, Commodore Ballroom | Concerts or performing arts | medium |
| Vancouver Playhouse | Performing arts | small |

Unrecognized venue/type combinations are excluded rather than assigned an invented size. In this version, high attendance means medium or large under this policy. This is a model input heuristic, not proof of actual attendance or traffic impact.

Select large before medium before small. Within a size tier, use this explicit venue priority: BC Place, Rogers Arena, Queen Elizabeth Theatre, Orpheum, Vogue Theatre, Commodore Ballroom, Vancouver Playhouse. Then choose earliest start time, then provider event ID. This tie-break is a deterministic approximation, not a numeric crowd estimate.

## Request handling

Fetch pages sequentially with 100 results per page, at most five pages, and a ten-second total upstream time budget. Keep pagination under Ticketmaster's documented deep-paging limit. More pages, malformed candidate records, or failure after a usable page produce partial status; they never silently imply an exhaustive negative result. No automatic retries in v1. A server-side 15-minute successful-response cache limits repeated identical lookups; failures are not cached.

The key stays in transit-forecaster/.env.local. Provide a tracked .env.example with an empty placeholder and update the existing ignore rule to allow it. Never return the key or credential-bearing request URL in logs/errors. Missing configuration returns a descriptive HTTP 503 error without calling Ticketmaster.

## Implementation boundaries and validation

Keep the HTTP handler in app/api/events/route.ts, provider access and normalization in lib/ticketmaster.ts, and venue/size rules in a small configuration module. Keep the existing health route and frontend unchanged.

Use mocked provider responses to verify valid/invalid dates, Vancouver day boundaries, cross-midnight overlap, venue/type filtering, add-on exclusion, cancellation and uncertain times, missing end time, duplicate records, deterministic selection, no-match results, pagination, partial failure, missing configuration, and rate-limit/timeout failures. Run the app's lint and production build. Once the user supplies a key locally, verify known major-venue dates against live Ticketmaster responses before claiming live coverage.

## Developer setup and coverage

Create a developer account at https://developer-account.ticketmaster.com/user/register, complete the account activation steps, and obtain a Discovery API key from the signed-in portal. Store it locally as TICKETMASTER_API_KEY in transit-forecaster/.env.local. Discovery uses the API key query parameter; no customer OAuth flow is required for event search.

Ticketmaster is a source for ticketed music, sports, theatre/performing arts, comedy, festivals, and family attractions through its supported ticketing platforms. Coverage for specific venues and dates still requires live validation. Free civic events, demonstrations, independently ticketed conferences, community gatherings, private events, and other non-ticketed traffic drivers may be absent. These are expected coverage risks inferred from a ticketing catalog, not guarantees that every event in those categories is missing.

The venue allowlist further narrows coverage intentionally. A negative response must be explained as no qualifying event found in the checked Ticketmaster coverage, not no downtown event or no expected traffic disruption. Convention Centre listings and web search are possible future sources, outside this version.

## Source

[Ticketmaster Discovery API documentation](https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/) documents authentication, query filters, event fields, status flags, pagination, and quotas. Discovery does not document an expected-attendance field; all size rules above are application policy.
