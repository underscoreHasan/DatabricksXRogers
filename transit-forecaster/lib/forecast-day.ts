import { isCalendarDate } from "./date.ts";
import { invokeForecast, invokeTypicalForecast } from "./databricks-serving.ts";
import type { ForecastRequest, ForecastRecord } from "./forecast.ts";
import { GET as weather } from "../app/api/weather/route.ts";
import { GET as events } from "../app/api/events/route.ts";
import { GET as holiday } from "../app/api/holiday/route.ts";
import { GET as dayOfWeek } from "../app/api/day-of-week/route.ts";

type Handler = (request: Request) => Response | Promise<Response>;
type ContextName = "weather" | "events" | "holiday" | "dayOfWeek";
type Context = Record<ContextName, Record<string, unknown> | null>;
type Options = {
  providers?: Record<ContextName, Handler>;
  invoke?: (body: ForecastRequest) => Promise<Response>;
  invokeTypical?: (body: ForecastRequest) => Promise<Response>;
  modelKind?: "prototype" | "trained";
};
const HALF_HOUR = 1_800_000;
const clock = (i: number) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const numeric = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function recordsForDay(date: string, context: Context): ForecastRecord[] {
  // Serving expects Vancouver wall-clock timestamps without offsets, not UTC.
  const midnight = Date.parse(`${date}T00:00:00-07:00`);
  const event = object(context.events?.event) ? context.events.event : null;
  const start = typeof event?.startTime === "string" ? Date.parse(event.startTime) : NaN;
  const end = typeof event?.endTime === "string" ? Date.parse(event.endTime) : NaN;
  const weatherRows = Array.isArray(context.weather?.weather) ? context.weather.weather : [];
  return Array.from({ length: 48 }, (_, i) => {
    const row: ForecastRecord = { date, slot_start: `${date}T${clock(i)}:00` };
    const reading = weatherRows[i];
    if (object(reading) && typeof reading.time_local === "string" && reading.time_local.slice(0, 16) === `${date}T${clock(i)}`) {
      if (typeof reading.rain === "boolean") row.rain = reading.rain;
      for (const key of ["temp_c", "precip_mm", "rain_mm"] as const) {
        if (typeof reading[key] === "number" && Number.isFinite(reading[key])) row[key] = reading[key];
      }
    }
    const ids: string[] = [];
    if (context.holiday?.isHoliday === true) ids.push("holiday");
    if (event && end > start && start < midnight + (i + 1) * HALF_HOUR && end > midnight + i * HALF_HOUR) {
      // The serving contract recognizes large/small; medium remains a generic event.
      const size = ["small", "medium", "large"].includes(String(event.size)) ? String(event.size) : "other";
      ids.push(`${size}_ticketmaster`);
    }
    if (ids.length || context.events?.lookupStatus === "ok") row.event_ids = ids;
    return row;
  });
}

function adaptPredictions(payload: unknown, date: string) {
  if (!object(payload) || !Array.isArray(payload.predictions) || payload.predictions.length !== 48) {
    throw new Error("Expected 48 serving predictions for the requested date.");
  }
  const rows = payload.predictions;
  if (!rows.every(row => object(row) && row.date === date && typeof row.clock === "string"
    && typeof row.slot_start === "string" && row.slot_start.slice(0, 16) === `${date}T${row.clock}`)) {
    throw new Error("Serving returned an invalid date or timestamp.");
  }
  rows.sort((a, b) => a.clock.localeCompare(b.clock));
  if (rows.some((row, i) => row.clock !== clock(i))) throw new Error("Serving intervals are missing or duplicated.");
  return {
    slots: rows.map(row => ({ time: row.clock, volume: numeric(row.volume_p50), dwellTime: numeric(row.dwell_p50) })),
    baseline: rows.map(row => ({ time: row.clock, volume: numeric(row.usual_volume), dwellTime: numeric(row.usual_dwell) })),
    models: [...new Set(rows.map(row => row.model))],
  };
}

/** Date-based UI adapter. The original POST serving contract is unchanged. */
export function createForecastDayHandler({ providers = { weather, events, holiday, dayOfWeek }, invoke = invokeForecast, invokeTypical = invokeTypicalForecast, modelKind }: Options = {}) {
  return async function GET(request: Request): Promise<Response> {
    const dates = new URL(request.url).searchParams.getAll("date");
    if (dates.length !== 1 || !isCalendarDate(dates[0])) {
      return Response.json({ error: "Provide one valid date as YYYY-MM-DD." }, { status: 400 });
    }
    const date = dates[0];
    const entries = await Promise.all(Object.entries(providers).map(async ([name, handler]) => {
      try {
        const response = await handler(new Request(new URL(`/api/${name}?date=${date}`, request.url)));
        const value: unknown = await response.json();
        return [name, response.ok && object(value) && value.date === date ? value : null];
      } catch { return [name, null]; }
    }));
    const context = Object.fromEntries(entries) as Context;
    const projectionErrors: Record<string, string> = {};
    const load = async (name: string, call: (body: ForecastRequest) => Promise<Response>, body: ForecastRequest) => {
      try {
        const response = await call(body);
        if (!response.ok) throw new Error(`Databricks request failed (HTTP ${response.status}).`);
        return adaptPredictions(await response.json(), date);
      } catch (error) {
        projectionErrors[name] = error instanceof Error ? error.message : "Forecast unavailable.";
        return null;
      }
    };
    const [selected, typical] = await Promise.all([
      load("selectedDay", invoke, { dataframe_records: recordsForDay(date, context) }),
      load("typicalDay", invokeTypical, { dataframe_records: [{ date }] }),
    ]);
    if (!selected && !typical) {
      return Response.json({ error: "Both Databricks forecasts are unavailable.", projectionErrors }, { status: 503 });
    }
    // Prefer the trained model's own baseline. The dummy fills only unavailable metrics.
    const modelVolume = Boolean(selected?.baseline.every(row => row.volume !== null));
    const modelDwell = Boolean(selected?.baseline.every(row => row.dwellTime !== null));
    const baselineSources = {
      volume: modelVolume ? "trained" : typical?.slots.every(row => row.volume !== null) ? "dummy" : "unavailable",
      dwell: modelDwell ? "trained" : typical?.slots.every(row => row.dwellTime !== null) ? "dummy" : "unavailable",
    };
    const typicalDay = Object.values(baselineSources).every(source => source === "unavailable") ? null
      : Array.from({ length: 48 }, (_, i) => ({
        time: clock(i),
        volume: modelVolume ? selected!.baseline[i].volume : typical?.slots[i].volume ?? null,
        dwellTime: modelDwell ? selected!.baseline[i].dwellTime : typical?.slots[i].dwellTime ?? null,
      }));
    if (baselineSources.volume !== "unavailable" && baselineSources.dwell !== "unavailable") delete projectionErrors.typicalDay;
    const kind = modelKind ?? (process.env.DATABRICKS_MODEL_KIND === "prototype" ? "prototype" : "trained");
    return Response.json({
      date, timezone: "America/Vancouver", dwellTimeUnit: "minutes", demo: kind !== "trained",
      selectedDay: selected?.slots ?? null, typicalDay, baselineSources, context, projectionErrors,
      serving: { kind, models: selected?.models ?? [], typicalModels: typical?.models ?? [] },
    }, { headers: { "Cache-Control": "no-store" } });
  };
}
