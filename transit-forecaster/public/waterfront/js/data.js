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

/** Fixed illustrative profiles; neither weather nor events change these values. */
export function createFallbackForecast(date) {
  const selectedVolume = [100,70,50,45,65,150,350,620,900,780,620,650,700,660,690,820,1100,1400,1550,1200,950,600,350,180];
  const typicalVolume = [90,60,40,35,55,120,280,540,760,650,530,560,610,580,600,750,950,1120,1050,800,600,420,250,140];
  const selectedDwell = [14,13,12,12,12,13,14,16,18,17,18,20,22,21,20,21,24,27,30,28,25,22,18,16];
  const typicalDwell = [12,12,11,11,11,12,13,14,16,15,16,18,20,19,18,19,21,23,24,22,20,18,15,13];
  const rows = (volumes, dwell) => Array.from({ length: 48 }, (_, i) => ({
    time: slotLabel(i), volume: volumes[Math.floor(i / 2)], dwellTime: dwell[Math.floor(i / 2)],
  }));
  return {
    date, timezone: CONFIG.timezone, dwellTimeUnit: 'minutes', demo: false,
    selectedDay: rows(selectedVolume, selectedDwell), typicalDay: rows(typicalVolume, typicalDwell),
    sources: { selectedDay: 'fallback', typicalDay: 'fallback' },
    dwellSources: { selectedDay: 'fallback', typicalDay: 'fallback' }, context: {},
  };
}

/** The rendering layer consumes only this validated, small view model. */
export function normalizeForecast(raw, requestedDate, { fallback } = {}) {
  if (!raw || raw.date !== requestedDate) throw new Error('The response date does not match the requested date.');
  if (raw.timezone !== CONFIG.timezone) throw new Error(`Response timezone must be ${CONFIG.timezone}.`);
  if (raw.dwellTimeUnit !== CONFIG.dwellTimeUnit) throw new Error('Response dwellTimeUnit must be minutes.');
  const context = raw.context && typeof raw.context === 'object' ? raw.context : {};
  // Do not combine a correct projection with context for a different day.
  for (const key of ['weather', 'events', 'holiday', 'dayOfWeek']) {
    if (context[key]?.date && context[key].date !== requestedDate) throw new Error(`context.${key}.date does not match the requested date.`);
  }
  const sources = {}, dwellSources = {}, projectionErrors = {};
  const projection = name => {
    const source = raw.demo === true ? 'demo' : 'model';
    if (!fallback) {
      const rows = validateProjection(raw[name], name);
      sources[name] = dwellSources[name] = source;
      return rows;
    }
    const rows = raw[name];
    const aligned = Array.isArray(rows) && rows.length === 48 && rows.every((row, i) => row?.time === slotLabel(i));
    const volumeReady = aligned && rows.every(row => finitePositive(row.volume));
    const dwellReady = aligned && rows.every(row => finitePositive(row.dwellTime));
    sources[name] = volumeReady ? source : 'fallback';
    dwellSources[name] = dwellReady ? source : 'fallback';
    if (!volumeReady || !dwellReady) {
      const error = raw.projectionErrors?.[name];
      projectionErrors[name] = typeof error === 'string' ? `${name}: ${error}`
        : `${name}: missing or invalid ${!volumeReady ? 'volume' : ''}${!volumeReady && !dwellReady ? ' and ' : ''}${!dwellReady ? 'dwell' : ''}.`;
    }
    return fallback[name].map((slot, i) => ({ time: slot.time,
      volume: volumeReady ? rows[i].volume : slot.volume,
      dwellTime: dwellReady ? rows[i].dwellTime : slot.dwellTime,
    }));
  };
  return {
    date: raw.date, timezone: raw.timezone, dwellTimeUnit: raw.dwellTimeUnit,
    selectedDay: projection('selectedDay'), typicalDay: projection('typicalDay'),
    context, demo: raw.demo === true, sources, dwellSources, projectionErrors, baselineSources: raw.baselineSources,
  };
}

/** Simple display adjustments on top of the source forecast; not model attribution. */
export function applyVolumeBoosts(forecast) {
  const context = forecast.context ?? {};
  const lookup = context.events;
  const event = lookup?.date === forecast.date && ['ok', 'partial'].includes(lookup.lookupStatus)
    ? eventWindow(lookup.event, forecast.date) : null;
  const size = lookup?.event?.size;
  const eventAmount = size === 'large' ? 300 : size === 'medium' ? 200 : size === 'small' ? 100 : 0;
  const weather = context.weather?.date === forecast.date ? context.weather.weather : null;
  return { ...forecast, selectedDay: forecast.selectedDay.map((slot, i) => {
    const eventBoost = event && i < event.endSlot && i + 1 > event.startSlot ? eventAmount : 0;
    const reading = weather?.[i];
    // rain_mm is an hourly amount repeated in each half-hour, not a total to sum.
    const wet = reading?.rain === true && Number.isFinite(reading.rain_mm) && reading.rain_mm > 0
      && reading.time_local?.slice(0, 16) === `${forecast.date}T${slot.time}`;
    const rainBoost = wet ? (reading.rain_mm < 1 ? 50 : reading.rain_mm < 4 ? 100 : 150) : 0;
    const baseVolume = slot.baseVolume ?? slot.volume;
    return { ...slot, baseVolume, eventBoost, rainBoost, volume: baseVolume + eventBoost + rainBoost };
  }) };
}

/** Centered five-slot mean; retain source values so repeated renders never compound it. */
export function smoothTypicalDay(forecast) {
  const rows = forecast.typicalDay;
  return { ...forecast, typicalDay: rows.map((slot, i) => {
    const neighbors = rows.slice(Math.max(0, i - 2), i + 3);
    const volume = neighbors.reduce((sum, row) => sum + (row.baseVolume ?? row.volume), 0) / neighbors.length;
    return { ...slot, baseVolume: slot.baseVolume ?? slot.volume, volume };
  }) };
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
    startsBeforeDay: start < midnight, endsAfterDay: end > midnight + DAY_MS,
    endTimeEstimated: event.endTimeEstimated === true,
    sourceUrl: safeSourceUrl(event.sourceUrl),
  };
}

/** Wet half-hours are merged into contiguous, end-exclusive timeline bands. */
export function rainWindows(weather, date) {
  if (!weather || weather.date !== date || !Array.isArray(weather.weather) || weather.weather.length !== 48) return [];
  const windows = [];
  for (let i = 0; i < 48; i++) {
    if (weather.weather[i]?.rain !== true) continue;
    const previous = windows.at(-1);
    if (previous?.endSlot === i) {
      previous.endSlot = i + 1;
      previous.endLabel = slotLabel(i + 1);
    } else {
      windows.push({ startSlot: i, endSlot: i + 1, startLabel: slotLabel(i), endLabel: slotLabel(i + 1) });
    }
  }
  return windows;
}

export function contextForSlot(forecast, index) {
  const context = forecast.context;
  const weatherData = context.weather;
  const weatherSlot = weatherData?.weather?.[index];
  let weather = { title: forecast.contextPending ? 'Loading weather…' : 'Weather unavailable', detail: forecast.contextErrors?.weather || 'No weather context was returned.' };
  if (weatherSlot && Number.isFinite(weatherSlot.temp_c)) {
    const historical = weatherData.mode === 'historical_average';
    const rain = weatherSlot.rain === true ? (historical ? 'rainfall average' : 'rain forecast') : weatherSlot.rain === false ? 'no rain indicated' : 'rain status unknown';
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
  else if (!event) events = lookup.lookupStatus === 'partial' ? 'Event lookup incomplete (partial coverage)' : 'No qualifying event found in the checked venues';
  else {
    events = active ? 'Event overlaps this interval' : index + 1 <= event.startSlot ? 'Event starts later today' : 'Event has ended';
    events += ` · ${event.startLabel}–${event.endLabel}${event.endTimeEstimated ? ' (estimated end)' : ''}`;
    if (lookup.lookupStatus === 'partial') events += ' · Partial coverage';
  }
  return { weather, holiday, events, event, eventActive: Boolean(active) };
}
