import { isCalendarDate } from "./date.ts";

type Options = { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number };
type ProviderData = {
  hourly_units: Record<string, string>;
  hourly: { time: number[]; temperature_2m: (number | null)[]; precipitation: (number | null)[]; rain: (number | null)[]; showers?: (number | null)[] };
};
type Features = { temp_c: number; precip_mm: number; rain_mm: number };
type Slot = Features & { time: string; time_local: string; rain: boolean };
const HISTORY_YEARS = 3;

const DAY = 86_400_000;
const HOUR = 3_600_000;
const TIMEZONE = "America/Vancouver";
// Keep these coordinates and feature conversions aligned with Databricks training.
const COORDINATES = { latitude: "49.286", longitude: "-123.111" };
const formatOptions: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
};
const formatter = new Intl.DateTimeFormat("en-CA", { ...formatOptions, timeZone: TIMEZONE });
// BC adopted permanent UTC-7 in 2026; older Node/provider tzdata still falls back.
// https://news.gov.bc.ca/releases/2026AG0013-000209
const PERMANENT_TIME_START = Date.parse("2026-03-08T10:00:00Z");
const PERMANENT_TIMEZONE = "Etc/GMT+7"; // IANA's Etc/GMT sign is inverted.
const permanentFormatter = new Intl.DateTimeFormat("en-CA", { ...formatOptions, timeZone: PERMANENT_TIMEZONE });
function localParts(time: number) {
  const active = time >= PERMANENT_TIME_START ? permanentFormatter : formatter;
  return Object.fromEntries(active.formatToParts(time).map(part => [part.type, part.value]));
}
function localDate(time: number) {
  const p = localParts(time);
  return `${p.year}-${p.month}-${p.day}`;
}
function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().split("T")[0];
}
function midnight(date: string) {
  const target = Date.parse(`${date}T00:00:00Z`);
  let time = target;
  for (let i = 0; i < 3; i++) {
    const p = localParts(time);
    time += target - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour));
  }
  return time;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function localTimestamp(time: number) {
  const p = localParts(time);
  const offset = (Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour)) - Math.floor(time / HOUR) * HOUR) / HOUR;
  return new Date(time + offset * HOUR).toISOString().slice(0, 19)
    + `${offset < 0 ? "-" : "+"}${String(Math.abs(offset)).padStart(2, "0")}:00`;
}
function features(data: ProviderData, index: number | undefined, forecast: boolean): Features {
  if (index === undefined) throw new Error("Missing weather hour");
  const temp = data.hourly.temperature_2m[index];
  const precipitation = data.hourly.precipitation[index];
  const rain = data.hourly.rain[index];
  const showers = forecast ? data.hourly.showers?.[index] : 0;
  if (!finite(temp) || !finite(precipitation) || !finite(rain) || !finite(showers)) throw new Error("Incomplete weather readings");
  // The archive's rain already includes showers; forecasts report them separately.
  return { temp_c: temp, precip_mm: precipitation, rain_mm: rain + showers };
}
function average(rows: Features[]): Features {
  if (!rows.length) throw new Error("No historical readings for this hour");
  return {
    temp_c: rows.reduce((sum, row) => sum + row.temp_c, 0) / rows.length,
    precip_mm: rows.reduce((sum, row) => sum + row.precip_mm, 0) / rows.length,
    rain_mm: rows.reduce((sum, row) => sum + row.rain_mm, 0) / rows.length,
  };
}
function slot(time: number, values: Features): Slot {
  return { time: new Date(time).toISOString(), time_local: localTimestamp(time), rain: values.rain_mm > 0, ...values };
}

export function createWeatherHandler({ fetchImpl = fetch, now = () => new Date(), timeoutMs = 10_000 }: Options = {}) {
  const cache = new Map<string, { expires: number; data: ProviderData }>();

  async function load(url: URL, forecast: boolean, signal: AbortSignal): Promise<ProviderData> {
    const key = url.toString();
    const cached = cache.get(key);
    if (cached && cached.expires > now().getTime()) return cached.data;
    const response = await fetchImpl(key, { signal, cache: "no-store" });
    if (!response.ok) throw new Error("Weather provider failed");
    const data = await response.json() as ProviderData;
    const times = data?.hourly?.time;
    const variables = forecast ? ["temperature_2m", "precipitation", "rain", "showers"] as const : ["temperature_2m", "precipitation", "rain"] as const;
    if (!Array.isArray(times) || !times.length || data?.hourly_units?.time !== "unixtime"
      || times.some((t, i) => !finite(t) || t % 3600 !== 0 || (i > 0 && t !== times[i - 1] + 3600))
      || variables.some(variable => {
        const values = data.hourly[variable];
        return data.hourly_units[variable] !== (variable === "temperature_2m" ? "°C" : "mm")
          || !Array.isArray(values) || values.length !== times.length
          || values.some(value => value !== null && (!finite(value) || (variable !== "temperature_2m" && value < 0)));
      })) throw new Error("Invalid weather data");
    if (variables.every(variable => data.hourly[variable]!.every(finite))) {
      if (cache.size >= 64) cache.delete(cache.keys().next().value!);
      cache.set(key, { data, expires: now().getTime() + (forecast ? 15 * 60_000 : DAY) });
    }
    return data;
  }

  function providerUrl(forecast: boolean) {
    const url = new URL(forecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive");
    url.search = new URLSearchParams({
      ...COORDINATES,
      timezone: forecast ? (now().getTime() >= PERMANENT_TIME_START ? PERMANENT_TIMEZONE : TIMEZONE) : "GMT",
      timeformat: "unixtime", temperature_unit: "celsius", precipitation_unit: "mm",
      hourly: forecast ? "temperature_2m,precipitation,rain,showers" : "temperature_2m,precipitation,rain",
    }).toString();
    return url;
  }

  async function historicalFeatures(date: string, years: number[], signal: AbortSignal) {
    const profiles = await Promise.all(years.map(async year => {
      let reference = `${year}${date.slice(4)}`;
      if (!isCalendarDate(reference)) reference = `${year}-02-28`;
      const start = midnight(reference);
      const end = midnight(addDays(reference, 1));
      const url = providerUrl(false);
      // Fetch UTC days around the local day, then use only its actual hours.
      // This also preserves the last hour of historical 25-hour autumn days.
      url.searchParams.set("start_date", new Date(start).toISOString().slice(0, 10));
      url.searchParams.set("end_date", new Date(end - 1).toISOString().slice(0, 10));
      const data = await load(url, false, signal);
      const indices = new Map(data.hourly.time.map((time, i) => [time, i]));
      const hours: Features[][] = Array.from({ length: 24 }, () => []);
      for (let time = start; time < end; time += HOUR) {
        hours[Number(localParts(time).hour)].push(features(data, indices.get(time / 1000), false));
      }
      // A repeated hour gets one mean per year; a skipped DST hour has no sample.
      return hours.map(rows => rows.length ? average(rows) : undefined);
    }));
    return Array.from({ length: 24 }, (_, hour) => average(
      profiles.map(profile => profile[hour]).filter((value): value is Features => value !== undefined),
    ));
  }

  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const date = params.get("date");
    const today = localDate(now().getTime());
    if (params.getAll("date").length !== 1 || !date || !isCalendarDate(date) || date < today) {
      return Response.json({ error: "Supply one valid date in YYYY-MM-DD format, today or later in Vancouver." }, { status: 400 });
    }
    if ([...params.keys()].some(key => key !== "date")) {
      return Response.json({ error: "Only date is accepted. Weather source and the three-year history are selected automatically." }, { status: 400 });
    }
    const historical = date > addDays(today, 15);
    const currentYear = Number(today.slice(0, 4));
    const years = historical ? Array.from({ length: HISTORY_YEARS }, (_, i) => currentYear - HISTORY_YEARS + i) : [];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const start = midnight(date);
      const end = midnight(addDays(date, 1));
      const weather: Slot[] = [];
      if (historical) {
        const hourly = await historicalFeatures(date, years, controller.signal);
        for (let time = start; time < end; time += HOUR / 2) {
          weather.push(slot(time, hourly[Number(localParts(time).hour)]));
        }
      } else {
        const url = providerUrl(true);
        url.searchParams.set("start_date", today);
        url.searchParams.set("end_date", addDays(today, 15));
        const data = await load(url, true, controller.signal);
        const indices = new Map(data.hourly.time.map((time, i) => [time, i]));
        for (let time = start; time < end; time += HOUR / 2) {
          weather.push(slot(time, features(data, indices.get(Math.floor(time / HOUR) * 3600), true)));
        }
      }
      return Response.json({
        date, timezone: TIMEZONE, mode: historical ? "historical_average" : "forecast", years_used: years,
        start_time: weather[0].time, n_slots: weather.length, slot_minutes: 30, source_interval_minutes: 60, weather,
      });
    } catch {
      return Response.json({ error: "Weather data is unavailable. Please try again later." }, { status: 503 });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
