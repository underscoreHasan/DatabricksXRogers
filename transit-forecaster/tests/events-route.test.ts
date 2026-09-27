import assert from "node:assert/strict";
import { test, after } from "node:test";
const originalKey = process.env.TICKETMASTER_API_KEY;
delete process.env.TICKETMASTER_API_KEY;
const { GET } = await import("../app/api/events/route.ts");
after(() => { if (originalKey !== undefined) process.env.TICKETMASTER_API_KEY = originalKey; });

test("invalid HTTP input returns 400 before checking credentials", async () => {
  for (const query of ["", "?date=bad", "?date=2027-02-30", "?date=2000-01-01", "?date=2099-01-01&date=2099-01-01"]) {
    const response = await GET(new Request(`http://localhost/api/events${query}`));
    assert.equal(response.status, 400);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("missing credentials return a descriptive safe 503 and unknown attendance", async () => {
  const response = await GET(new Request("http://localhost/api/events?date=2099-01-01"));
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.lookupStatus, "unavailable");
  assert.equal(body.event, null);
  assert.equal(body.hasHighAttendanceEvent, null);
  assert.match(body.error, /TICKETMASTER_API_KEY/);
});
