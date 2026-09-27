import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeatherHandler } from "../lib/weather.ts";

const now = () => new Date("2026-09-26T19:00:00Z");
const request = (query: string) => new Request(`http://localhost/api/weather${query}`);
function weather(start = "2026-09-26T07:00:00Z", hours = 384, temp = 12) {
  const time = Array.from({ length: hours }, (_, i) => Date.parse(start) / 1000 + i * 3600);
  return { hourly_units: { time: "unixtime", temperature_2m: "°C", rain: "mm", showers: "mm" }, hourly: {
    time, temperature_2m: time.map(() => temp), rain: time.map((_, i) => i === 24 ? 0.2 : 0), showers: time.map((_, i) => i === 25 ? 0.1 : 0),
  } };
}

test("forecast returns UTC half-hour slots for the requested Vancouver date", async () => {
  let calls = 0;
  const handler = createWeatherHandler({ now, fetchImpl: async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.open-meteo.com");
    assert.equal(url.searchParams.get("timezone"), "Etc/GMT+7"); // Vancouver now stays on UTC-7.
    assert.ok(!(url.searchParams.has("forecast_days") && url.searchParams.has("start_date")));
    assert.equal(url.searchParams.get("hourly"), "temperature_2m,rain,showers");
    return Response.json(weather());
  } });
  const response = await handler(request("?date=2026-09-27"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "forecast");
  assert.equal(body.n_slots, 48);
  assert.equal(body.slot_minutes, 30);
  assert.deepEqual(body.weather[0], { time: "2026-09-27T07:00:00.000Z", rain: true, temp_c: 12 });
  assert.deepEqual(body.weather[1], { time: "2026-09-27T07:30:00.000Z", rain: true, temp_c: 12 });
  assert.equal(body.weather[2].rain, true); // Convective showers count as rain too.
  assert.equal(body.weather[4].rain, false);
  assert.equal(body.weather.at(-1).time, "2026-09-28T06:30:00.000Z");
  assert.equal(body.start_time, body.weather[0].time);
  await handler(request("?date=2026-09-28"));
  assert.equal(calls, 1); // Cached forecast covers multiple dates.
});

test("dates outside the forecast window require an explicit rain choice", async () => {
  let calls = 0;
  const handler = createWeatherHandler({ now, fetchImpl: async () => { calls++; return Response.json(weather()); } });
  assert.equal((await handler(request("?date=2026-10-11"))).status, 200);
  const response = await handler(request("?date=2026-10-12"));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).requires_rain_choice, true);
  assert.equal(calls, 1);
});

test("simulation averages completed historical years and honors true and false", async () => {
  const queries: URL[] = [];
  const handler = createWeatherHandler({ now, fetchImpl: async (input) => {
    const url = new URL(String(input));
    queries.push(url);
    assert.equal(url.hostname, "archive-api.open-meteo.com");
    const start = url.searchParams.get("start_date")!;
    const end = url.searchParams.get("end_date")!;
    const hours = (Date.parse(end) - Date.parse(start)) / 3_600_000 + 24;
    const year = Number(start.slice(0, 4));
    const data = weather(`${start}T07:00:00Z`, hours, ({ 2025: 10, 2024: 20, 2023: 30 } as Record<number, number>)[year]);
    data.hourly.temperature_2m = data.hourly.time.map((_, i) => data.hourly.temperature_2m[i] + i % 24);
    return Response.json(data);
  } });
  for (const rain of [true, false]) {
    const response = await handler(request(`?date=2027-06-30&rain=${rain}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.mode, "simulation");
    assert.equal(body.temperature_source, "historical_average");
    assert.equal(body.weather.length, 48);
    assert.ok(body.weather.every((slot: { rain: boolean }) => slot.rain === rain));
    assert.equal(body.weather[0].temp_c, 20);
    assert.equal(body.weather[2].temp_c, 21);
  }
  assert.equal(queries.length, 3); // Toggling rain reuses historical data.
  assert.deepEqual(queries.map(url => url.searchParams.get("start_date")?.slice(0, 4)).sort(), ["2023", "2024", "2025"]);
});

test("validates date and rain parameters before any network requests", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async () => { assert.fail("Unexpected network request"); } });
  for (const query of ["", "?date=banana", "?date=2027-02-30", "?date=2026-09-25", "?date=2026-10-10&date=2026-10-10", "?date=2027-01-01&rain=yes", "?date=2027-01-01&rain=", "?date=2027-01-01&rain=true&rain=false"]) {
    assert.equal((await handler(request(query))).status, 400, query);
  }
});

test("missing forecast readings prompt a scenario instead of inventing dry weather", async () => {
  const data = weather();
  const incomplete = { ...data, hourly: { ...data.hourly, rain: data.hourly.rain.map(() => null) } };
  const handler = createWeatherHandler({ now, fetchImpl: async () => Response.json(incomplete) });
  const response = await handler(request("?date=2026-09-27"));
  assert.equal(response.status, 422);
  assert.equal((await response.json()).requires_rain_choice, true);
});

test("HTTP, malformed response, invalid units, and timeout failures return 503", async () => {
  for (const fetchImpl of [
    async () => new Response(null, { status: 429 }),
    async () => Response.json({}),
    async () => Response.json({ ...weather(), hourly_units: { temperature_2m: "°F" } }),
    async () => { throw new Error("network failed"); },
    async (_input: unknown, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    }),
  ]) {
    const handler = createWeatherHandler({ now, fetchImpl, timeoutMs: 20 });
    const response = await handler(request("?date=2026-09-27"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).weather, undefined);
  }
});

test("missing historical temperatures fail rather than becoming zero degrees", async () => {
  const data = weather();
  const handler = createWeatherHandler({ now, fetchImpl: async () => Response.json({ ...data, hourly: { ...data.hourly, temperature_2m: data.hourly.time.map(() => null) } }) });
  assert.equal((await handler(request("?date=2027-06-30&rain=false"))).status, 503);
});

test("a Vancouver daylight-saving day keeps consecutive real half-hour slots", async () => {
  const handler = createWeatherHandler({ now: () => new Date("2025-11-01T19:00:00Z"), fetchImpl: async () => Response.json(weather("2025-11-01T07:00:00Z")) });
  const response = await handler(request("?date=2025-11-02"));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.n_slots, 50);
  assert.equal(body.weather[0].time, "2025-11-02T07:00:00.000Z");
  assert.equal(body.weather.at(-1).time, "2025-11-03T07:30:00.000Z");
});


test("Vancouver stays on UTC-7 after the March 2026 transition", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async () => Response.json(weather()) });
  for (const date of ["2026-11-01", "2027-01-01"]) {
    const response = await handler(request(`?date=${date}&rain=false`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.n_slots, 48);
    assert.equal(body.start_time, `${date}T07:00:00.000Z`);
  }
});
