import { isCalendarDate } from "./date.ts";

type Options = { fetchImpl?: typeof fetch; now?: () => Date; timeoutMs?: number };
type ProviderData = {
  hourly_units: Record<string, string>;
  hourly: { time: number[]; temperature_2m: (number | null)[]; rain?: (number | null)[]; showers?: (number | null)[] };
};
type Slot = { time: string; rain: boolean; temp_c: number };

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
function rainChoice() {
  return Response.json({
    error: "A complete forecast is unavailable for this date. Choose rain=true or rain=false to simulate using historical temperatures.",
    requires_rain_choice: true,
  }, { status: 422 });
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
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
    const variables = forecast ? ["temperature_2m", "rain", "showers"] as const : ["temperature_2m"] as const;
    if (!Array.isArray(times) || !times.length || data?.hourly_units?.time !== "unixtime"
      || times.some((t, i) => !finite(t) || t % 3600 !== 0 || (i > 0 && t !== times[i - 1] + 3600))
      || variables.some(variable => {
        const values = data.hourly[variable];
        return data.hourly_units[variable] !== (variable === "temperature_2m" ? "°C" : "mm")
          || !Array.isArray(values) || values.length !== times.length
          || values.some(value => value !== null && (!finite(value) || (variable !== "temperature_2m" && value < 0)));
      })) throw new Error("Invalid weather data");
    if (cache.size >= 64) cache.delete(cache.keys().next().value!);
    cache.set(key, { data, expires: now().getTime() + (forecast ? 15 * 60_000 : DAY) });
    return data;
  }

  function providerUrl(forecast: boolean) {
    const url = new URL(forecast ? "https://api.open-meteo.com/v1/forecast" : "https://archive-api.open-meteo.com/v1/archive");
    url.search = new URLSearchParams({
      ...COORDINATES,
      timezone: forecast && now().getTime() >= PERMANENT_TIME_START ? PERMANENT_TIMEZONE : TIMEZONE,
      timeformat: "unixtime", temperature_unit: "celsius",
      hourly: forecast ? "temperature_2m,rain,showers" : "temperature_2m",
    }).toString();
    return url;
  }

  async function historicalTemperatures(date: string, year: number, signal: AbortSignal) {
    const readings = await Promise.all([1, 2, 3].map(async offset => {
      const referenceYear = year - offset;
      let reference = `${referenceYear}${date.slice(4)}`;
      if (!isCalendarDate(reference)) reference = `${referenceYear}-02-28`;
      const start = addDays(reference, -7);
      const end = addDays(reference, 7);
      const url = providerUrl(false);
      url.searchParams.set("start_date", start < `${referenceYear}-01-01` ? `${referenceYear}-01-01` : start);
      url.searchParams.set("end_date", end > `${referenceYear}-12-31` ? `${referenceYear}-12-31` : end);
      return load(url, false, signal);
    }));
    const buckets: number[][] = Array.from({ length: 24 }, () => []);
    for (const data of readings) {
      const coveredHours = new Set<number>();
      data.hourly.time.forEach((time, i) => {
        const temp = data.hourly.temperature_2m[i];
        if (finite(temp)) {
          const hour = Number(localParts(time * 1000).hour);
          buckets[hour].push(temp);
          coveredHours.add(hour);
        }
      });
      if (coveredHours.size !== 24) throw new Error("Incomplete historical temperatures");
    }
    return buckets.map(values => Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10);
  }

  return async function GET(request: Request): Promise<Response> {
    const params = new URL(request.url).searchParams;
    const date = params.get("date");
    const rain = params.get("rain");
    const today = localDate(now().getTime());
    if (params.getAll("date").length !== 1 || !date || !isCalendarDate(date) || date < today) {
      return Response.json({ error: "Supply one valid date in YYYY-MM-DD format, today or later in Vancouver." }, { status: 400 });
    }
    if (params.getAll("rain").length > 1 || (rain !== null && rain !== "true" && rain !== "false")) {
      return Response.json({ error: "rain must be true or false, supplied once." }, { status: 400 });
    }
    const simulation = rain !== null;
    if (!simulation && date > addDays(today, 15)) return rainChoice();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const start = midnight(date);
      const end = midnight(addDays(date, 1));
      const weather: Slot[] = [];
      if (simulation) {
        const temperatures = await historicalTemperatures(date, Number(today.slice(0, 4)), controller.signal);
        for (let time = start; time < end; time += HOUR / 2) {
          weather.push({ time: new Date(time).toISOString(), rain: rain === "true", temp_c: temperatures[Number(localParts(time).hour)] });
        }
      } else {
        const url = providerUrl(true);
        url.searchParams.set("start_date", today);
        url.searchParams.set("end_date", addDays(today, 15));
        url.searchParams.set("precipitation_unit", "mm");
        const data = await load(url, true, controller.signal);
        const indices = new Map(data.hourly.time.map((time, i) => [time, i]));
        for (let time = start; time < end; time += HOUR / 2) {
          const i = indices.get(Math.floor(time / HOUR) * 3600);
          if (i === undefined) return rainChoice();
          const temp = data.hourly.temperature_2m[i];
          const rainfall = data.hourly.rain?.[i];
          const showers = data.hourly.showers?.[i];
          if (!finite(temp) || !finite(rainfall) || !finite(showers)) return rainChoice();
          weather.push({ time: new Date(time).toISOString(), rain: rainfall + showers > 0, temp_c: temp });
        }
      }
      return Response.json({
        date, mode: simulation ? "simulation" : "forecast",
        temperature_source: simulation ? "historical_average" : "forecast",
        start_time: weather[0].time, n_slots: weather.length, slot_minutes: 30, weather,
      });
    } catch {
      return Response.json({ error: "Weather data is unavailable. Please try again later." }, { status: 503 });
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  };
}
