import { isCalendarDate } from "./date.ts";
export { isCalendarDate };

export type EventSize = "small" | "medium" | "large";

export type MainEvent = {
  name: string;
  startTime: string;
  endTime: string;
  endTimeEstimated: boolean;
  size: EventSize;
  sourceUrl: string;
};

export type EventLookup = {
  date: string;
  lookupStatus: "ok" | "partial" | "unavailable";
  hasHighAttendanceEvent: boolean | null;
  event: MainEvent | null;
};

// Policy estimates, not measured attendance or traffic-spike durations.
export const DURATION_HOURS: Record<EventSize, number> = { small: 3, medium: 4, large: 5 };

// Order is the deterministic priority within each size tier. Match full names only.
export const VENUES: { name: string; size: EventSize; aliases: string[] }[] = [
  { name: "BC Place", size: "large", aliases: ["BC Place Stadium"] },
  { name: "Rogers Arena", size: "large", aliases: [] },
  { name: "Queen Elizabeth Theatre", size: "medium", aliases: [] },
  { name: "Orpheum", size: "medium", aliases: ["Orpheum Theatre"] },
  { name: "Harbour Event & Convention Centre", size: "medium", aliases: [] },
  { name: "Vogue Theatre", size: "medium", aliases: ["Vogue Theatre-BC"] },
  { name: "Commodore Ballroom", size: "medium", aliases: [] },
  { name: "Vancouver Playhouse", size: "small", aliases: [] },
  { name: "The Pearl", size: "small", aliases: [] },
  { name: "Rickshaw Theatre", size: "small", aliases: [] },
  { name: "Fortune Sound Club", size: "small", aliases: [] },
];

export function normalizeName(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/&/g, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Vancouver", year: "numeric", month: "2-digit", day: "2-digit",
});

export function localDate(date: Date): string {
  const parts = dateFormatter.formatToParts(date);
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)!.value).join("-");
}


export function parseDate(values: string[]): string | null {
  if (values.length !== 1 || !isCalendarDate(values[0])) return null;
  return values[0];
}
