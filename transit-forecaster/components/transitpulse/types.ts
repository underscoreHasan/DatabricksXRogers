export type Season = "Winter" | "Spring" | "Summer" | "Fall";

export interface EventWindow {
  start: number; // hour, 0-23
  end: number;
  label: string;
  detail: string;
}

export interface DayContext {
  iso: string;
  dow: number; // 0 Sun - 6 Sat
  weekend: boolean;
  holiday: boolean;
  cruise: boolean;
  event: boolean;
  windows: EventWindow[];
  season: Season;
}

export interface HourPoint {
  hour: number;
  baseline: number;
  actual: number;
  deviation: number; // percent
  dwell: number; // minutes
}

export interface DayInsights {
  ctx: DayContext;
  hourly: HourPoint[];
  avgDeviation: number;
  visitPct: number;
  avgDwell: number;
  isFuture: boolean;
}
