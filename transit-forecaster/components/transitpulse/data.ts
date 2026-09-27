import type { DayContext, DayInsights, EventWindow, HourPoint, Season } from "./types";

// Waterfront Station sits next to Canada Place, Vancouver's cruise terminal —
// Alaska season runs roughly April through October.
export const CRUISE_WINDOW: EventWindow = {
  start: 9,
  end: 16,
  label: "Cruise ship in port",
  detail: "Passengers disembarking and reboarding near Canada Place.",
};

export const EVENT_WINDOW: EventWindow = {
  start: 18,
  end: 22,
  label: "Citywide event nearby",
  detail: "Evening event drawing extra foot traffic to the area.",
};

const HOLIDAYS_2026 = [
  "2026-01-01",
  "2026-02-16",
  "2026-04-03",
  "2026-05-18",
  "2026-07-01",
  "2026-08-03",
  "2026-09-07",
  "2026-10-12",
  "2026-11-11",
  "2026-12-25",
];

// Deterministic PRNG (mulberry32) seeded from the date string, so a given
// date always renders the same "actual" pattern.
function seededRng(seedStr: string) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (Math.imul(h, 31) + seedStr.charCodeAt(i)) | 0;
  return function rng() {
    h |= 0;
    h = (h + 0x6d2b79f5) | 0;
    let t = Math.imul(h ^ (h >>> 15), 1 | h);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function season(month: number): Season {
  if (month <= 1 || month === 11) return "Winter";
  if (month <= 4) return "Spring";
  if (month <= 7) return "Summer";
  return "Fall";
}

function isCruiseSeason(month: number) {
  return month >= 3 && month <= 9; // Apr - Oct
}

export function getDayContext(date: Date): DayContext {
  const iso = date.toISOString().slice(0, 10);
  const dow = date.getDay();
  const weekend = dow === 0 || dow === 6;
  const holiday = HOLIDAYS_2026.includes(iso);
  const rng = seededRng(iso);
  const cruise = isCruiseSeason(date.getMonth()) && !weekend && rng() < 0.28;
  const event = rng() < 0.1;
  const windows: EventWindow[] = [];
  if (cruise) windows.push(CRUISE_WINDOW);
  if (event) windows.push(EVENT_WINDOW);
  return { iso, dow, weekend, holiday, cruise, event, windows, season: season(date.getMonth()) };
}

function gauss(x: number, mu: number, sigma: number) {
  return Math.exp(-((x - mu) ** 2) / (2 * sigma * sigma));
}

export function baselineCurve(dow: number, szn: Season): number[] {
  const weekend = dow === 0 || dow === 6;
  const sznMult = szn === "Summer" ? 1.25 : szn === "Winter" ? 0.85 : 1.0;
  const out: number[] = [];
  for (let h = 0; h < 24; h++) {
    const v = weekend
      ? 30 + 70 * gauss(h, 13.5, 3.2) + 40 * gauss(h, 19, 2.5)
      : 20 + 90 * gauss(h, 8, 1.1) + 100 * gauss(h, 17.3, 1.3) + 25 * gauss(h, 12.5, 2);
    out.push(Math.max(4, v * sznMult));
  }
  return out;
}

function hourlyDwell(hour: number, ctx: DayContext): number {
  const rushHour = (hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18);
  let base = ctx.weekend ? 34 : rushHour ? 14 : 24;
  if (ctx.cruise && hour >= CRUISE_WINDOW.start && hour <= CRUISE_WINDOW.end) base *= 1.9;
  if (ctx.event && hour >= EVENT_WINDOW.start && hour <= EVENT_WINDOW.end) base *= 1.5;
  return Math.round(base);
}

export function getDayInsights(date: Date): DayInsights {
  const ctx = getDayContext(date);
  const base = baselineCurve(ctx.dow, ctx.season);
  const rng = seededRng(ctx.iso + "-actual");

  const hourly: HourPoint[] = base.map((baseline, hour) => {
    let mult = 1 + (rng() - 0.5) * 0.18;
    if (ctx.holiday) mult *= 0.55;
    if (ctx.cruise && hour >= CRUISE_WINDOW.start && hour <= CRUISE_WINDOW.end) mult *= 1.55;
    if (ctx.event && hour >= EVENT_WINDOW.start && hour <= EVENT_WINDOW.end) mult *= 1.45;
    const actual = Math.max(2, baseline * mult);
    const deviation = ((actual - baseline) / baseline) * 100;
    return { hour, baseline, actual, deviation, dwell: hourlyDwell(hour, ctx) };
  });

  const avgDeviation = hourly.reduce((a, b) => a + b.deviation, 0) / hourly.length;

  let visitPct = ctx.weekend ? 42 : 22;
  if (ctx.cruise) visitPct += 30;
  if (ctx.event) visitPct += 10;
  visitPct = Math.min(85, visitPct + (rng() - 0.5) * 6);

  const avgDwell = ctx.cruise ? 68 : ctx.weekend ? 45 : 22;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const isFuture = date > today;

  return { ctx, hourly, avgDeviation, visitPct, avgDwell, isFuture };
}

export function activityLabel(avgDeviation: number): { label: string; tone: "quiet" | "typical" | "elevated" | "busy" } {
  if (avgDeviation < -15) return { label: "Quiet", tone: "quiet" };
  if (avgDeviation < 15) return { label: "Typical", tone: "typical" };
  if (avgDeviation < 40) return { label: "Elevated", tone: "elevated" };
  return { label: "Busy", tone: "busy" };
}

export function hourLabel(hour: number): string {
  const ampm = hour < 12 ? "AM" : "PM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${ampm}`;
}
