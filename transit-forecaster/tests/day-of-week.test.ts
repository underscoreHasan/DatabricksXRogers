import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { GET } from "../app/api/day-of-week/route.ts";

const request = (query: string) => new Request(`http://localhost/api/day-of-week${query}`);

test("returns the weekday name and Monday=1 through Sunday=7", async () => {
  const cases = [
    ["2026-10-05", "Monday", 1], ["2026-10-06", "Tuesday", 2],
    ["2026-10-07", "Wednesday", 3], ["2026-10-08", "Thursday", 4],
    ["2026-10-09", "Friday", 5], ["2026-10-10", "Saturday", 6],
    ["2026-10-11", "Sunday", 7],
  ];
  for (const [date, dayOfWeek, dayOfWeekNumber] of cases) {
    const response = GET(request(`?date=${date}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date, dayOfWeek, dayOfWeekNumber });
  }
});

test("supports historical dates, leap days, and year boundaries", async () => {
  for (const [date, dayOfWeek, dayOfWeekNumber] of [
    ["2020-01-01", "Wednesday", 3], ["2024-02-29", "Thursday", 4],
    ["2025-12-31", "Wednesday", 3], ["2026-01-01", "Thursday", 4],
  ]) {
    const response = GET(request(`?date=${date}`));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { date, dayOfWeek, dayOfWeekNumber });
  }
});

test("rejects absent, repeated, malformed, and impossible calendar dates", async () => {
  for (const query of ["", "?date=", "?date=banana", "?date=2026-2-01", "?date=2026-02-30", "?date=2100-02-29", "?date=2026-13-01", "?date=2026-10-00", "?date=2026-10-10T00:00:00Z", "?date=%202026-10-10", "?date=2026-10-10&date=2026-10-10"]) {
    const response = GET(request(query));
    assert.equal(response.status, 400, query);
    assert.equal(typeof (await response.json()).error, "string");
  }
});

test("the supplied calendar date is unchanged by the server timezone", () => {
  const moduleUrl = new URL("../app/api/day-of-week/route.ts", import.meta.url).href;
  const script = `import { GET } from ${JSON.stringify(moduleUrl)};
    const response = GET(new Request("http://localhost/api/day-of-week?date=2026-10-10"));
    process.stdout.write(await response.text());`;
  for (const zone of ["UTC", "America/Vancouver", "Asia/Tokyo"]) {
    const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      encoding: "utf8", env: { ...process.env, TZ: zone },
    });
    assert.deepEqual(JSON.parse(output), { date: "2026-10-10", dayOfWeek: "Saturday", dayOfWeekNumber: 6 }, zone);
  }
});
