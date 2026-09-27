# Ticketmaster events implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Return one verified downtown Vancouver event from a date-only API.

**Architecture:** A Next.js route validates input and calls a small Ticketmaster service. The service normalizes events against a venue policy, selects one result, and caches complete responses in process for 15 minutes.

**Tech Stack:** Existing Next.js/TypeScript, native fetch/Intl, Node 24 test runner; no new dependencies.

**Spec:** docs/superpowers/specs/2026-09-26-ticketmaster-events-design.md

## Global Constraints

- Use the current `api_get_event` branch as requested. Keep the health route and frontend unchanged.
- Date-only input, today/future in America/Vancouver; reject missing, repeated, malformed, impossible, and past dates.
- Ticketmaster Discovery only. No database, background jobs, new UI, genre restriction, or attendance claims.
- Use the eleven approved venues and priority order from the spec. Small/medium/large estimate durations are 3/4/5 elapsed hours.
- Prefer valid confirmed provider ends; identify estimated ends. Return one event including small events.
- Fetch 100 events per page, at most five pages, sequentially within a ten-second total deadline; no retries.
- Never expose the key or credential-bearing URLs. Cache only complete successful lookups for 900 seconds, at most 128 dates per process.
- Complete negative => false; incomplete negative => null; verified medium/large => true. Unavailable => HTTP 503; partial => HTTP 200.

## Review Focus

- Vancouver midnight differs from UTC: overlap includes a previous-day late start but excludes an end exactly at local midnight.
- Missing/malformed pagination must not manufacture a definitive negative result.
- Classification/title exclusions must remove add-ons without removing legitimate artist names containing similar words.
- Multiple listings, aliases, and reversed provider order must select the same main event.
- Failures and partial results must not be cached as complete results, and no error may disclose a key.

---

### Task 1: Eligibility and selection rules

**Files:** Create `transit-forecaster/lib/event-policy.ts`, `transit-forecaster/lib/ticketmaster.ts`, `transit-forecaster/tests/fixtures.ts`, `transit-forecaster/tests/event-policy.test.ts`. Modify `transit-forecaster/package.json` and `transit-forecaster/tsconfig.json` for native TypeScript tests.

**Interfaces:** Policy exports `EventSize`, `MainEvent`, `EventLookup`, venue configuration, `localDate(date: Date): string`, and `parseDate(values: string[], now?: Date): string | null`. Ticketmaster exports `selectEvent(records: unknown[], date: string): { event: MainEvent | null; malformed: boolean }`.

- [x] Write tests for date validation, local-day overlap, all duration sizes, confirmed-end preference and invalid-end fallback, allowlist/location validation, all accepted statuses, unknown/uncertain/canceled rejection, genuine genres vs add-ons, deduplication, and deterministic venue/start/ID ranking.
- [x] Run `npm test`; observe failures against empty implementations.
- [x] Implement the policy and selection. Use Intl America/Vancouver dates and half-open interval overlap; normalize exact venue names and explicit aliases. Treat malformed potentially eligible records as incomplete, not as empty matches.
- [x] Run `npm test`; expected: all policy tests pass.

### Task 2: Provider and cache

**Files:** Extend `transit-forecaster/lib/ticketmaster.ts`; create `transit-forecaster/tests/ticketmaster.test.ts`.

**Interfaces:** Consumes Task 1's selection/result types. Exports `createEventLookup(options: { apiKey: string; fetchImpl?: typeof fetch; now?: () => number; timeoutMs?: number; pageDelayMs?: number }): (date: string) => Promise<EventLookup>`. Production defaults: real fetch, Date.now, 10,000 ms deadline, 500 ms between pages.

- [x] Write tests for Vancouver/BC/CA query and previous-day discovery, later-page winning event, no matches, malformed pages/candidates, page cap, partial failure, missing key, HTTP 429, deadline, complete-only caching, expiry, and incomplete true/null semantics.
- [x] Run `npm test`; expected: provider tests fail before implementation.
- [x] Implement bounded sequential pagination using a single abort deadline, safe error handling, and the complete-response cache. Do not log provider exceptions or request URLs. Deduplicate simultaneous requests for the same date.
- [x] Run `npm test`; expected: all tests pass.

### Task 3: HTTP integration and verification

**Files:** Create `transit-forecaster/app/api/events/route.ts`, `transit-forecaster/tests/events-route.test.ts`, `transit-forecaster/.env.example`; modify `transit-forecaster/.gitignore`, `transit-forecaster/README.md`, and the spec's implementation status.

**Interfaces:** `GET(request: Request): Promise<Response>` consumes `parseDate` and the provider lookup. Read `TICKETMASTER_API_KEY` server-side only; return descriptive safe configuration error if absent.

- [x] Write HTTP-handler tests for invalid/repeated/past input and missing configuration; run and observe failure before the route exists.
- [x] Add the handler and env setup/API examples. Document coverage limits and the future-date restriction.
- [x] Run `npm test`, `npm run lint`, `npm run build`, and `git diff --check`; expected: all pass.
- [x] Run the built server, verify invalid date returns 400, and call a known major-venue date with the configured key; expected: HTTP 200, correct event, explicit timezone and estimated-end flag. Record only public venue IDs/data, never credentials.
- [x] Review the whole change with a fresh reviewer, fix substantive findings with regression tests, then commit the finished feature. Push and create a PR if available credentials permit; report the concrete blocker otherwise.

## Execution record

User approved implementation after the completed design discussion. Implement inline on the explicitly requested current branch; one final feature commit keeps this hackathon change easy to review. Today's live discovery confirms BC Place and Rogers Arena events, and multiple IDs for Fortune Sound Club and The Pearl. Exact names remain the eligibility key; verified IDs are coverage evidence, not an exclusive filter.

Verification: 46 tests, lint, production build, and both live endpoint checks passed. Final review found one pagination-completeness defect; two regression tests failed before the fix and passed afterward. No other review findings remain.
