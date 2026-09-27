import { isCalendarDate } from "./date.ts";

export type ForecastRecord = {
  date: string;
  slot_start?: string;
  rain?: boolean;
  temp_c?: number;
  precip_mm?: number;
  rain_mm?: number;
  event_ids?: string[];
};

export type ForecastRequest = { dataframe_records: ForecastRecord[] };

const SLOT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$/;

export class ForecastValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ForecastValidationError";
  }
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function parseSlotStart(value: unknown): void {
  if (value === undefined || value === null) return;
  if (typeof value !== "string" || !SLOT.test(value) || !isCalendarDate(value.slice(0, 10))) {
    throw new ForecastValidationError("slot_start must be an ISO 8601 datetime.");
  }
}

function parseEventIds(value: unknown): void {
  if (value === undefined || value === null) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new ForecastValidationError("event_ids must be an array of strings.");
  }
}

export function parseForecastRequest(body: unknown): ForecastRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body) || !("dataframe_records" in body)) {
    throw new ForecastValidationError("Request must be a JSON object with dataframe_records.");
  }
  const records = (body as { dataframe_records: unknown }).dataframe_records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new ForecastValidationError("dataframe_records must be a non-empty list.");
  }
  for (const [index, raw] of records.entries()) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ForecastValidationError(`dataframe_records[${index}] must be an object.`);
    }
    const row = raw as Record<string, unknown>;
    if (typeof row.date !== "string" || !isCalendarDate(row.date)) {
      throw new ForecastValidationError("Missing date or not YYYY-MM-DD.");
    }
    parseSlotStart(row.slot_start);
    if (row.rain !== undefined && row.rain !== null && typeof row.rain !== "boolean") {
      throw new ForecastValidationError("rain must be a boolean.");
    }
    for (const field of ["temp_c", "precip_mm", "rain_mm"] as const) {
      if (row[field] !== undefined && row[field] !== null && !finite(row[field])) {
        throw new ForecastValidationError(`${field} must be a finite number.`);
      }
    }
    parseEventIds(row.event_ids);
  }
  return body as ForecastRequest;
}
