import assert from "node:assert/strict";
import { test } from "node:test";
import { GET } from "../app/api/holiday/route.ts";

const request = (query: string) => new Request(`http://localhost/api/holiday${query}`);
const holiday = (date: string, observedDate = date) => ({
  id: 34, date, nameEn: "Christmas Day", nameFr: "Noël", federal: 1, observedDate,
});
const payload = (date: string, observedDate = date) => ({ province: {
  id: "BC", nameEn: "British Columbia", nameFr: "Colombie-Britannique",
  sourceLink: "https://www2.gov.bc.ca/", sourceEn: "Statutory Holidays in British Columbia",
  holidays: [holiday(date, observedDate)], nextHoliday: holiday(date, observedDate),
} });

test("looks up B.C. holidays for the supplied year, including future years", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    assert.equal(url.origin, "https://canada-holidays.ca");
    assert.equal(url.pathname, "/api/v1/provinces/BC");
    assert.equal(url.searchParams.get("optional"), "false");
    return Response.json(payload(`${url.searchParams.get("year")}-12-25`));
  });
  for (const date of ["2027-12-25", "2028-12-25", "2038-12-25"]) {
    const response = await GET(request(`?date=${date}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date, isHoliday: true });
  }
});

test("matches the holiday date without shifting it to an observed day", async (t) => {
  t.mock.method(globalThis, "fetch", async () => Response.json(payload("2027-12-25", "2027-12-27")));
  for (const [date, isHoliday] of [
    ["2027-12-24", false], ["2027-12-25", true],
    ["2027-12-26", false], ["2027-12-27", false],
  ] as const) {
    const response = await GET(request(`?date=${date}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date, isHoliday });
  }
});

test("rejects missing, repeated, impossible, or unsupported dates before fetching", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("unexpected fetch"); });
  for (const query of [
    "", "?date=", "?date=banana", "?date=2027-2-01", "?date=2027-02-29",
    "?date=2027-04-31", "?date=2027-12-25T00:00:00Z",
    "?date=2027-12-25&date=2027-12-25", "?date=2012-12-25", "?date=2039-01-01",
  ]) {
    const response = await GET(request(query));
    assert.equal(response.status, 400, query);
    assert.equal(typeof (await response.json()).error, "string");
  }
  assert.equal(calls, 0);
});

test("reports provider errors as unavailable instead of a false holiday result", async (t) => {
  for (const fetchResponse of [
    async () => new Response("unavailable", { status: 503 }),
    async () => { throw new Error("network unavailable"); },
    async () => { throw new DOMException("timed out", "TimeoutError"); },
    async () => new Response("invalid JSON"),
    async () => Response.json({}),
    async () => Response.json({ province: { id: "BC", holidays: [] } }),
    async () => Response.json({ province: { id: "BC", holidays: [{}] } }),
    async () => Response.json({ province: { id: "ON", holidays: [holiday("2027-12-25")] } }),
    async () => Response.json(payload("2026-12-25")),
  ]) {
    const mock = t.mock.method(globalThis, "fetch", fetchResponse);
    const response = await GET(request("?date=2027-12-25"));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(typeof body.error, "string");
    assert.equal(body.isHoliday, undefined);
    mock.mock.restore();
  }
});
