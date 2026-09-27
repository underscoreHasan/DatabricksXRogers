import assert from "node:assert/strict";
import { test } from "node:test";
import { createEventLookup } from "../lib/ticketmaster.ts";
import { fixture, page, venue } from "./fixtures.ts";

const day = "2026-10-10";
const key = "test-key-never-return-this";
const options = { apiKey: key, pageDelayMs: 0 };
const small = () => fixture({ _embedded: { venues: [venue("The Pearl")] } });

test("queries the fixed area and two local days without a genre filter", async () => {
  let request: URL | undefined;
  const lookup = createEventLookup({ ...options, fetchImpl: async (input) => { request = new URL(String(input)); return page([fixture()]); } });
  const result = await lookup(day);
  assert.equal(result.lookupStatus, "ok");
  assert.equal(result.hasHighAttendanceEvent, true);
  assert.equal(request?.origin, "https://app.ticketmaster.com");
  assert.equal(request?.pathname, "/discovery/v2/events.json");
  assert.equal(request?.searchParams.get("apikey"), key);
  assert.equal(request?.searchParams.get("city"), "Vancouver");
  assert.equal(request?.searchParams.get("stateCode"), "BC");
  assert.equal(request?.searchParams.get("countryCode"), "CA");
  assert.equal(request?.searchParams.get("localStartEndDateTime"), "2026-10-09T00:00:00,2026-10-10T23:59:59");
  assert.equal(request?.searchParams.get("size"), "100");
  assert.equal(request?.searchParams.has("classificationName"), false);
  assert.equal(JSON.stringify(result).includes(key), false);
});

test("selects a larger event from a later page", async () => {
  const pages: string[] = [];
  const lookup = createEventLookup({ ...options, fetchImpl: async (input) => {
    const number = new URL(String(input)).searchParams.get("page")!;
    pages.push(number);
    return number === "0" ? page([small()], 0, 2) : page([fixture()], 1, 2);
  } });
  const result = await lookup(day);
  assert.equal(result.event?.size, "large");
  assert.equal(result.lookupStatus, "ok");
  assert.deepEqual(pages, ["0", "1"]);
});

test("a complete empty catalog has an explicit negative", async () => {
  const lookup = createEventLookup({ ...options, fetchImpl: async () => Response.json({ page: { size: 100, totalElements: 0, totalPages: 0, number: 0 } }) });
  assert.deepEqual(await lookup(day), { date: day, lookupStatus: "ok", hasHighAttendanceEvent: false, event: null });
});

test("a complete small event is returned with a false high-attendance flag", async () => {
  const result = await createEventLookup({ ...options, fetchImpl: async () => page([small()]) })(day);
  assert.equal(result.event?.size, "small");
  assert.equal(result.hasHighAttendanceEvent, false);
});

for (const [record, expected] of [[small(), null], [fixture(), true]] as const) {
  test(`a failed later page preserves the event and flag ${expected}`, async () => {
    let calls = 0;
    const result = await createEventLookup({ ...options, fetchImpl: async () => ++calls === 1 ? page([record], 0, 2) : new Response(null, { status: 429 }) })(day);
    assert.equal(result.lookupStatus, "partial");
    assert.equal(result.hasHighAttendanceEvent, expected);
    assert.ok(result.event);
    assert.equal(calls, 2);
  });
}

test("stops after five pages without claiming an exhaustive negative", async () => {
  let calls = 0;
  const result = await createEventLookup({ ...options, fetchImpl: async () => page([small()], calls++, 6) })(day);
  assert.equal(calls, 5);
  assert.equal(result.lookupStatus, "partial");
  assert.equal(result.hasHighAttendanceEvent, null);
});

test("malformed candidates preserve valid results but make the lookup partial", async () => {
  const result = await createEventLookup({ ...options, fetchImpl: async () => page([small(), null]) })(day);
  assert.equal(result.event?.size, "small");
  assert.equal(result.lookupStatus, "partial");
  assert.equal(result.hasHighAttendanceEvent, null);
});

test("missing or malformed pagination is never a definitive negative", async () => {
  for (const pagination of [undefined, { number: 0, totalPages: "1" }, { size: 100, totalElements: 1, number: 4, totalPages: 1 }]) {
    const result = await createEventLookup({ ...options, fetchImpl: async () => Response.json({ _embedded: { events: [small()] }, page: pagination }) })(day);
    assert.equal(result.lookupStatus, "partial");
    assert.equal(result.hasHighAttendanceEvent, null);
  }
});

test("a malformed response envelope is unavailable", async () => {
  for (const payload of [{}, { page: { size: 100, totalElements: 2, totalPages: 1, number: 0 } }, { _embedded: { events: {} } }]) {
    const result = await createEventLookup({ ...options, fetchImpl: async () => Response.json(payload) })(day);
    assert.equal(result.lookupStatus, "unavailable");
    assert.equal(result.hasHighAttendanceEvent, null);
    assert.equal(result.event, null);
  }
});

test("missing configuration makes no network request", async () => {
  let calls = 0;
  const result = await createEventLookup({ apiKey: " ", fetchImpl: async () => { calls++; return page([]); } })(day);
  assert.equal(calls, 0);
  assert.equal(result.lookupStatus, "unavailable");
  assert.equal(result.hasHighAttendanceEvent, null);
});

test("provider HTTP errors, invalid JSON, and exceptions are safe unavailable results", async () => {
  for (const fetchImpl of [
    async () => new Response(key, { status: 429 }),
    async () => new Response("not json", { status: 200 }),
    async () => { throw new Error(`request failed: ?apikey=${key}`); },
  ]) {
    const result = await createEventLookup({ ...options, fetchImpl })(day);
    assert.deepEqual(result, { date: day, lookupStatus: "unavailable", hasHighAttendanceEvent: null, event: null });
    assert.equal(JSON.stringify(result).includes(key), false);
  }
});

test("the total deadline aborts a slow provider", async () => {
  const result = await createEventLookup({ ...options, timeoutMs: 20, fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  }) })(day);
  assert.equal(result.lookupStatus, "unavailable");
  assert.equal(result.hasHighAttendanceEvent, null);
});

test("the same deadline covers page delays and preserves the first page", async () => {
  let calls = 0;
  const result = await createEventLookup({ ...options, timeoutMs: 20, pageDelayMs: 100, fetchImpl: async () => { calls++; return page([small()], 0, 2); } })(day);
  assert.equal(calls, 1);
  assert.equal(result.lookupStatus, "partial");
  assert.equal(result.hasHighAttendanceEvent, null);
});

test("caches complete lookups for fifteen minutes and coalesces concurrent requests", async () => {
  let calls = 0;
  let clock = 0;
  const lookup = createEventLookup({ ...options, now: () => clock, fetchImpl: async () => { calls++; return page([fixture()]); } });
  const [first, concurrent] = await Promise.all([lookup(day), lookup(day)]);
  assert.deepEqual(concurrent, first);
  assert.equal(calls, 1);
  clock = 899_999;
  assert.deepEqual(await lookup(day), first);
  assert.equal(calls, 1);
  clock = 900_000;
  await lookup(day);
  assert.equal(calls, 2);
});

test("does not cache failures or partial results", async () => {
  let calls = 0;
  const lookup = createEventLookup({ ...options, fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(null, { status: 503 });
    if (calls === 2) return page([small(), null]);
    return page([fixture()]);
  } });
  assert.equal((await lookup(day)).lookupStatus, "unavailable");
  assert.equal((await lookup(day)).lookupStatus, "partial");
  assert.equal((await lookup(day)).lookupStatus, "ok");
  assert.equal(calls, 3);
});

test("bounds the in-process cache to 128 dates", async () => {
  let calls = 0;
  const lookup = createEventLookup({ ...options, fetchImpl: async () => { calls++; return page([]); } });
  for (let offset = 0; offset < 129; offset++) await lookup(new Date(Date.UTC(2027, 0, 1 + offset)).toISOString().slice(0, 10));
  await lookup("2027-01-01");
  assert.equal(calls, 130);
});


test("truncated final pages stay partial and are never cached as complete negatives", async () => {
  let calls = 0;
  const lookup = createEventLookup({ ...options, fetchImpl: async () => {
    calls++;
    return Response.json({ _embedded: { events: [small()] }, page: { size: 100, totalElements: 50, totalPages: 1, number: 0 } });
  } });
  assert.equal((await lookup(day)).lookupStatus, "partial");
  assert.equal((await lookup(day)).hasHighAttendanceEvent, null);
  assert.equal(calls, 2);
});

test("inconsistent total page counts cannot hide remaining events", async () => {
  const result = await createEventLookup({ ...options, fetchImpl: async () => Response.json({
    _embedded: { events: [small()] }, page: { size: 1, totalElements: 50, totalPages: 1, number: 0 },
  }) })(day);
  assert.equal(result.lookupStatus, "partial");
  assert.equal(result.hasHighAttendanceEvent, null);
});
