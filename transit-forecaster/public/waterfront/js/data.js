import { CONFIG } from './config.js';

const DAY_MS = 86_400_000;
const SLOT_MS = 30 * 60_000;
const finitePositive = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

export function localDate(now = new Date()) {
  return new Date(now.getTime() + CONFIG.utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

export function minimumDate(now = new Date()) {
  return new Date(Date.parse(`${localDate(now)}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

export function isFutureDate(value, now = new Date()) {
  return isCalendarDate(value) && value >= minimumDate(now);
}

export function slotLabel(index) {
  return index === 48 ? '24:00' : `${String(Math.floor(index / 2)).padStart(2, '0')}:${index % 2 ? '30' : '00'}`;
}

export function weekday(date) {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

export function dayLabel(date) {
  return new Intl.DateTimeFormat('en-CA', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`));
}

function validateProjection(rows, name) {
  if (!Array.isArray(rows) || rows.length !== 48) throw new Error(`${name} must contain exactly 48 half-hour intervals.`);
  return rows.map((row, i) => {
    if (!row || row.time !== slotLabel(i)) throw new Error(`${name}[${i}].time must be ${slotLabel(i)}. Intervals must be in local-time order.`);
    if (!finitePositive(row.volume) || !finitePositive(row.dwellTime)) throw new Error(`${name}[${i}] needs nonnegative numeric volume and dwellTime.`);
    return { time: row.time, volume: row.volume, dwellTime: row.dwellTime };
  });
}

/** The rendering layer consumes only this validated, small view model. */
export function normalizeForecast(raw, requestedDate) {
  if (!raw || raw.date !== requestedDate) throw new Error('The response date does not match the requested date.');
  if (raw.timezone !== CONFIG.timezone) throw new Error(`Response timezone must be ${CONFIG.timezone}.`);
  if (raw.dwellTimeUnit !== CONFIG.dwellTimeUnit) throw new Error('Response dwellTimeUnit must be minutes.');
  const context = raw.context && typeof raw.context === 'object' ? raw.context : {};
  // Do not combine a correct projection with context for a different day.
  for (const key of ['weather', 'events', 'holiday', 'dayOfWeek']) {
    if (context[key]?.date && context[key].date !== requestedDate) throw new Error(`context.${key}.date does not match the requested date.`);
  }
  return {
    date: raw.date, timezone: raw.timezone, dwellTimeUnit: raw.dwellTimeUnit,
    selectedDay: validateProjection(raw.selectedDay, 'selectedDay'),
    typicalDay: validateProjection(raw.typicalDay, 'typicalDay'),
    context, demo: raw.demo === true,
  };
}

export function volumeComparison(selected, typical) {
  return { difference: selected - typical, percent: typical > 0 ? Math.round((selected / typical - 1) * 100) : null };
}

function safeSourceUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

/** Convert the repo's UTC event timestamps to the selected day's local timeline. */
export function eventWindow(event, date) {
  if (!event || typeof event.name !== 'string') return null;
  const start = Date.parse(event.startTime), end = Date.parse(event.endTime);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const midnight = Date.parse(`${date}T00:00:00Z`) - CONFIG.utcOffsetMinutes * 60_000;
  if (end <= midnight || start >= midnight + DAY_MS) return null;
  const label = ms => {
    const local = new Date(ms + CONFIG.utcOffsetMinutes * 60_000).toISOString();
    const day = local.slice(0, 10);
    return `${day < date ? 'Previous day ' : day > date ? 'Next day ' : ''}${local.slice(11, 16)}`;
  };
  return {
    name: event.name,
    startSlot: Math.max(0, (start - midnight) / SLOT_MS),
    endSlot: Math.min(48, (end - midnight) / SLOT_MS),
    startLabel: label(start), endLabel: label(end),
    endTimeEstimated: event.endTimeEstimated === true,
    sourceUrl: safeSourceUrl(event.sourceUrl),
  };
}

export function contextForSlot(forecast, index) {
  const context = forecast.context;
  const weatherData = context.weather;
  const weatherSlot = weatherData?.weather?.[index];
  let weather = { title: 'Weather unavailable', detail: 'No weather context was returned.' };
  if (weatherSlot && Number.isFinite(weatherSlot.temp_c)) {
    const historical = weatherData.mode === 'historical_average';
    const rain = weatherSlot.rain === true ? (historical ? 'rainfall average' : 'rain forecast') : 'no rain indicated';
    weather = {
      title: `${Number(weatherSlot.temp_c.toFixed(1))} °C · ${rain}`,
      detail: historical ? 'Historical average · seasonal estimate' : weatherData.mode === 'forecast' ? 'Weather forecast' : 'Weather source unspecified',
    };
  }
  const flag = context.holiday?.isHoliday;
  const holiday = flag === true ? 'B.C. statutory holiday' : flag === false ? 'Not a statutory holiday' : 'Holiday status unavailable';
  const lookup = context.events;
  const event = eventWindow(lookup?.event, forecast.date);
  const active = event && index < event.endSlot && index + 1 > event.startSlot;
  let events;
  if (lookup?.lookupStatus === 'unavailable' || !lookup) events = 'Event lookup unavailable';
  else if (lookup.lookupStatus === 'partial') events = 'Event lookup incomplete (partial coverage)';
  else if (!event) events = 'No qualifying event found in the checked venues';
  else events = active ? 'Event overlaps this interval' : index + 1 <= event.startSlot ? 'Event starts later today' : 'Event has ended';
  return { weather, holiday, events, event, eventActive: Boolean(active) };
}
