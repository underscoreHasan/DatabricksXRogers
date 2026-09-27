import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDate } from "../lib/event-policy.ts";
import { selectEvent } from "../lib/ticketmaster.ts";
import { fixture, venue } from "./fixtures.ts";

const day = "2026-10-10";
const select = (records: unknown[], date = day) => selectEvent(records, date).event;
const at = (start: string, end?: Record<string, unknown>) => fixture({ dates: { start: { dateTime: start }, end, status: { code: "onsale" } } });

test("accepts past, current, and future calendar dates", () => {
  assert.equal(parseDate(["2000-01-01"]), "2000-01-01");
  assert.equal(parseDate(["2026-09-25"]), "2026-09-25");
  assert.equal(parseDate(["2028-02-29"]), "2028-02-29");
});

test("rejects missing, duplicate, malformed and impossible dates", () => {
  for (const values of [[], [day, day], [""], ["2026-2-01"], ["2026-02-30"], ["2027-02-29"], ["2026-10-10T00:00:00Z"], [" 2026-10-10"]]) {
    assert.equal(parseDate(values), null, JSON.stringify(values));
  }
});

test("returns a large event with a five-hour estimated end and source", () => {
  assert.deepEqual(select([fixture()]), {
    name: "Example concert", startTime: "2026-10-11T02:00:00.000Z", endTime: "2026-10-11T07:00:00.000Z",
    endTimeEstimated: true, size: "large", sourceUrl: "https://www.ticketmaster.ca/example/event/1",
  });
});

for (const [name, size, end] of [
  ["BC Place Stadium", "large", "07"], ["Rogers Arena", "large", "07"],
  ["Queen Elizabeth Theatre", "medium", "06"], ["Orpheum Theatre", "medium", "06"],
  ["Harbour Event & Convention Centre", "medium", "06"], ["Vogue Theatre-BC", "medium", "06"],
  ["Commodore Ballroom", "medium", "06"], ["Vancouver Playhouse", "small", "05"],
  ["The Pearl", "small", "05"], ["RICKSHAW THEATRE", "small", "05"], ["Fortune Sound Club", "small", "05"],
]) {
  test(`classifies ${name} and applies its duration`, () => {
    const result = select([fixture({ _embedded: { venues: [venue(name)] } })]);
    assert.equal(result?.size, size);
    assert.equal(result?.endTime, `2026-10-11T${end}:00:00.000Z`);
  });
}

test("requires an exact eligible venue in Vancouver, BC, Canada", () => {
  for (const candidate of [venue("Rogers Arena Parking"), venue("Harbour Centre"), venue("Vancouver Convention Centre"), venue("Rogers Arena", { city: { name: "Toronto" } }), venue("Rogers Arena", { state: { stateCode: "WA" } }), venue("Rogers Arena", { country: { countryCode: "US" } })]) {
    assert.equal(select([fixture({ _embedded: { venues: [candidate] } })]), null);
  }
  assert.equal(select([fixture({ _embedded: { venues: [venue("  ROGERS  ARENA ")] } })])?.size, "large");
});

test("uses a confirmed end time instead of the size heuristic", () => {
  const result = select([at("2026-10-10T19:00:00-07:00", { dateTime: "2026-10-10T21:30:00-07:00", approximate: false })]);
  assert.equal(result?.endTime, "2026-10-11T04:30:00.000Z");
  assert.equal(result?.endTimeEstimated, false);
});

test("falls back for missing, invalid, early, approximate and unspecified ends", () => {
  for (const end of [undefined, {}, { dateTime: "nonsense" }, { dateTime: "2026-10-11T02:00:00Z" }, { dateTime: "2026-10-11T01:00:00Z" }, { dateTime: "2026-10-11T04:00:00Z", approximate: true }, { dateTime: "2026-10-11T04:00:00Z", noSpecificTime: true }]) {
    const result = select([at("2026-10-11T02:00:00Z", end)]);
    assert.equal(result?.endTime, "2026-10-11T07:00:00.000Z");
    assert.equal(result?.endTimeEstimated, true);
  }
});

test("overlap includes a previous-night event but excludes exact midnight endings", () => {
  assert.ok(select([at("2026-10-10T05:00:00Z")])); // Oct 9, 22:00 + 5h overlaps Oct 10.
  assert.equal(select([at("2026-10-10T02:00:00Z")]), null); // Ends at Oct 10, 00:00.
  assert.ok(select([at("2026-10-10T07:00:00Z")])); // Begins at Oct 10, 00:00.
  assert.equal(select([at("2026-10-11T07:00:00Z")]), null); // Begins at next midnight.
  assert.ok(select([at("2026-10-08T02:00:00Z", { dateTime: "2026-10-11T06:00:00Z" })]));
});

test("respects Vancouver winter offset and DST transitions in interval overlap", () => {
  assert.equal(select([at("2026-01-10T03:00:00Z")], "2026-01-10"), null); // End 08:00Z is midnight.
  assert.ok(select([at("2026-01-10T04:00:00Z")], "2026-01-10"));
  assert.equal(select([at("2026-03-08T03:00:00Z")], "2026-03-08"), null);
  assert.equal(select([at("2026-03-09T07:00:00Z")], "2026-03-08"), null);
});

test("accepts genuine events regardless of genre and confirmed status", () => {
  for (const code of ["onsale", "offsale", "rescheduled"]) {
    assert.ok(select([fixture({ dates: { ...fixture().dates, status: { code } }, classifications: [{ segment: { name: "Arts & Theatre" }, genre: { name: "Comedy" } }] })]));
  }
  assert.ok(select([fixture({ name: "The Parking Lot Tour", classifications: [] })]));
});

test("excludes canceled, postponed, unknown statuses and uncertain start times", () => {
  for (const code of ["canceled", "cancelled", "postponed", "unknown"]) {
    assert.equal(select([fixture({ dates: { ...fixture().dates, status: { code } } })]), null);
  }
  for (const flag of ["dateTBD", "dateTBA", "timeTBA", "noSpecificTime"]) {
    assert.equal(select([fixture({ dates: { ...fixture().dates, start: { ...fixture().dates.start, [flag]: true } } })]), null);
  }
  assert.equal(select([fixture({ test: true })]), null);
});

test("excludes ancillary classifications and narrowly identified add-on titles", () => {
  for (const name of ["Parking - Example concert", "Example concert - VIP Upgrade", "Example concert - Merchandise Package", "Rogers Arena Suite Rental", "Example concert - Fast Lane Pass"] ) {
    assert.equal(select([fixture({ name })]), null, name);
  }
  assert.equal(select([fixture({ classifications: [{ type: { name: "Parking" } }] })]), null);
});

test("does not claim malformed candidate data is a complete negative", () => {
  for (const entry of [null, { unexpected: true }, fixture({ url: "javascript:alert(1)" }), fixture({ dates: { start: { dateTime: "2026-10-10T19:00:00" }, status: { code: "onsale" } } }), fixture({ _embedded: {} })]) {
    assert.deepEqual(selectEvent([entry], day), { event: null, malformed: true });
  }
});

test("ranks by size, venue priority, start, and ID independent of provider order", () => {
  const records = [
    fixture({ id: "rogers", name: "Earlier at Rogers" }),
    fixture({ id: "bc-z", name: "BC later", dates: { start: { dateTime: "2026-10-11T04:00:00Z" }, status: { code: "onsale" } }, _embedded: { venues: [venue("BC Place")] } }),
    fixture({ id: "bc-b", name: "BC second ID", _embedded: { venues: [venue("BC Place")] } }),
    fixture({ id: "bc-a", name: "BC winner", _embedded: { venues: [venue("BC Place")] } }),
    fixture({ id: "qet", name: "Medium", _embedded: { venues: [venue("Queen Elizabeth Theatre")] } }),
  ];
  assert.equal(select(records)?.name, "BC winner");
  assert.deepEqual(select(records.toReversed()), select(records));
});

test("duplicate IDs and equivalent listings do not change the winner", () => {
  const original = fixture({ id: "a", _embedded: { venues: [venue("Orpheum")] } });
  const duplicate = fixture({ id: "b", _embedded: { venues: [venue("Orpheum Theatre")] } });
  assert.deepEqual(select([original, original, duplicate]), select([original]));
});
