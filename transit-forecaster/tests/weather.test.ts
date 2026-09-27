import assert from "node:assert/strict";
import { test } from "node:test";
import { createWeatherHandler } from "../lib/weather.ts";

const now = () => new Date("2026-09-26T19:00:00Z");
const request = (query: string) => new Request(`http://localhost/api/weather${query}`);
function weather(start = "2026-09-26T07:00:00Z", hours = 384, temp = 12) {
  const time = Array.from({ length: hours }, (_, i) => Date.parse(start) / 1000 + i * 3600);
  return { hourly_units: { time: "unixtime", temperature_2m: "°C", precipitation: "mm", rain: "mm", showers: "mm" }, hourly: {
    time, temperature_2m: time.map(() => temp), precipitation: time.map(() => 0.8),
    rain: time.map<number>((_, i) => i === 24 ? 0.2 : 0), showers: time.map<number>((_, i) => i === 25 ? 0.1 : 0),
  } };
}
function archive(url: URL) {
  assert.equal(url.hostname, "archive-api.open-meteo.com");
  assert.equal(url.searchParams.get("timezone"), "GMT");
  assert.equal(url.searchParams.get("hourly"), "temperature_2m,precipitation,rain");
  const start = url.searchParams.get("start_date")!;
  const end = url.searchParams.get("end_date")!;
  const year = Number(start.slice(0, 4));
  const base = ({ 2025: 10, 2024: 20, 2023: 30 } as Record<number, number>)[year] ?? 12;
  const data = weather(`${start}T00:00:00Z`, (Date.parse(end) - Date.parse(start)) / 3_600_000 + 24, base);
  data.hourly.precipitation.fill(base / 10);
  data.hourly.rain.fill((base - 10) * 0.03);
  data.hourly.showers.fill(100); // Archive rain already includes showers; never add them again.
  return data;
}

test("forecast preserves all four features and labels local half-hour rows with hourly source resolution", async () => {
  let calls = 0;
  const handler = createWeatherHandler({ now, fetchImpl: async (input) => {
    calls++;
    const url = new URL(String(input));
    assert.equal(url.hostname, "api.open-meteo.com");
    assert.equal(url.searchParams.get("timezone"), "Etc/GMT+7");
    assert.ok(!(url.searchParams.has("forecast_days") && url.searchParams.has("start_date")));
    assert.equal(url.searchParams.get("hourly"), "temperature_2m,precipitation,rain,showers");
    return Response.json(weather());
  } });
  const response = await handler(request("?date=2026-09-27"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "forecast");
  assert.deepEqual(body.years_used, []);
  assert.equal(body.timezone, "America/Vancouver");
  assert.equal(body.n_slots, 48);
  assert.equal(body.slot_minutes, 30);
  assert.equal(body.source_interval_minutes, 60);
  assert.deepEqual(body.weather[0], { time: "2026-09-27T07:00:00.000Z", time_local: "2026-09-27T00:00:00-07:00", rain: true, temp_c: 12, precip_mm: 0.8, rain_mm: 0.2 });
  assert.deepEqual(body.weather[1], { ...body.weather[0], time: "2026-09-27T07:30:00.000Z", time_local: "2026-09-27T00:30:00-07:00" });
  assert.equal(body.weather[2].rain_mm, 0.1);
  assert.equal(body.weather[2].rain, true);
  assert.equal(body.weather[4].rain, false); // Snow-only precipitation is not rain.
  assert.equal(body.weather[4].precip_mm, 0.8);
  assert.equal(body.weather.at(-1).time_local, "2026-09-27T23:30:00-07:00");
  assert.equal(body.start_time, body.weather[0].time);
  await handler(request("?date=2026-09-28"));
  assert.equal(calls, 1);
});

test("today plus 15 days uses forecast and the next day automatically uses history", async () => {
  const hosts: string[] = [];
  const handler = createWeatherHandler({ now, fetchImpl: async input => {
    const url = new URL(String(input));
    hosts.push(url.hostname);
    return Response.json(url.hostname === "api.open-meteo.com" ? weather() : archive(url));
  } });
  const forecast = await handler(request("?date=2026-10-11"));
  assert.equal(forecast.status, 200);
  assert.equal((await forecast.json()).mode, "forecast");
  const historical = await handler(request("?date=2026-10-12"));
  assert.equal(historical.status, 200);
  assert.equal((await historical.json()).mode, "historical_average");
  assert.deepEqual(hosts, ["api.open-meteo.com", ...Array(3).fill("archive-api.open-meteo.com")]);
});

test("history averages only the matching local date and hour across three completed years", async () => {
  const queries: URL[] = [];
  const handler = createWeatherHandler({ now, fetchImpl: async input => {
    const url = new URL(String(input));
    queries.push(url);
    const data = archive(url);
    const year = url.searchParams.get("start_date")!.slice(0, 4);
    assert.equal(url.searchParams.get("start_date"), `${year}-06-30`);
    assert.equal(url.searchParams.get("end_date"), `${year}-07-01`);
    data.hourly.time.forEach((t, i) => {
      if (t < Date.parse(`${year}-06-30T07:00:00Z`) / 1000 || t >= Date.parse(`${year}-07-01T07:00:00Z`) / 1000) data.hourly.temperature_2m[i] = 999;
      if (t === Date.parse(`${year}-06-30T08:00:00Z`) / 1000) data.hourly.temperature_2m[i] += 1;
    });
    return Response.json(data);
  } });
  const response = await handler(request("?date=2027-06-30"));
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.mode, "historical_average");
  assert.deepEqual(body.years_used, [2023, 2024, 2025]);
  assert.equal(body.weather.length, 48);
  assert.equal(body.weather[0].temp_c, 20);
  assert.equal(body.weather[2].temp_c, 21);
  assert.equal(body.weather[0].precip_mm, 2);
  assert.ok(Math.abs(body.weather[0].rain_mm - 0.3) < 1e-10);
  assert.ok(body.weather.every((slot: { rain: boolean }) => slot.rain));
  await handler(request("?date=2027-06-30"));
  assert.equal(queries.length, 3);
});

test("validates the date-only contract before network requests", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async () => { assert.fail("Unexpected network request"); } });
  for (const query of ["", "?date=banana", "?date=2027-02-30", "?date=2026-09-25", "?date=2026-10-10&date=2026-10-10", "?date=2027-01-01&rain=true", "?date=2027-01-01&rain=false", "?date=2027-01-01&n_years=5"]) {
    assert.equal((await handler(request(query))).status, 400, query);
  }
});

test("missing forecast values return unavailable, never dry weather or silent historical substitution", async () => {
  for (const variable of ["temperature_2m", "precipitation", "rain", "showers"] as const) {
    const data = weather();
    const handler = createWeatherHandler({ now, fetchImpl: async input => {
      assert.equal(new URL(String(input)).hostname, "api.open-meteo.com");
      return Response.json({ ...data, hourly: { ...data.hourly, [variable]: data.hourly.time.map(() => null) } });
    } });
    const response = await handler(request("?date=2026-09-27"));
    assert.equal(response.status, 503);
    assert.equal((await response.json()).weather, undefined);
  }
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
    assert.equal((await handler(request("?date=2026-09-27"))).status, 503);
  }
});

test("a missing historical year's readings cannot silently change the three-year average", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async input => {
    const url = new URL(String(input));
    const data = archive(url);
    return Response.json(url.searchParams.get("start_date")!.startsWith("2024")
      ? { ...data, hourly: { ...data.hourly, rain: data.hourly.time.map(() => null) } } : data);
  } });
  assert.equal((await handler(request("?date=2027-06-30"))).status, 503);
});

test("Vancouver stays on UTC-7 after March 2026, including winter", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async input => Response.json(archive(new URL(String(input)))) });
  for (const date of ["2026-11-01", "2027-01-01"]) {
    const response = await handler(request(`?date=${date}`));
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.n_slots, 48);
    assert.equal(body.start_time, `${date}T07:00:00.000Z`);
    assert.equal(body.weather[0].time_local, `${date}T00:00:00-07:00`);
  }
});

test("February 29 uses February 28 only in non-leap reference years", async () => {
  const dates: string[] = [];
  const handler = createWeatherHandler({ now, fetchImpl: async input => {
    const url = new URL(String(input));
    dates.push(url.searchParams.get("start_date")!);
    return Response.json(archive(url));
  } });
  const response = await handler(request("?date=2028-02-29"));
  assert.equal(response.status, 200);
  assert.deepEqual(dates.sort(), ["2023-02-28", "2024-02-29", "2025-02-28"]);
});

test("a skipped historical DST hour uses available years and a repeated hour gives each year equal weight", async () => {
  const handler = createWeatherHandler({ now, fetchImpl: async input => {
    const url = new URL(String(input));
    const data = archive(url);
    if (url.searchParams.get("start_date") === "2024-11-03") {
      const repeated = data.hourly.time.indexOf(Date.parse("2024-11-03T09:00:00Z") / 1000);
      data.hourly.temperature_2m[repeated] = 80;
    }
    return Response.json(data);
  } });
  const spring = await handler(request("?date=2027-03-10"));
  assert.equal(spring.status, 200);
  assert.equal((await spring.json()).weather[4].temp_c, 20); // 2024 skipped 02:00; mean of 2023=30 and 2025=10.
  const fall = await handler(request("?date=2027-11-03"));
  assert.equal(fall.status, 200);
  assert.equal((await fall.json()).weather[2].temp_c, 30); // (2023:30 + 2024:(20+80)/2 + 2025:10) / 3.
});
