import test from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../js/data.js';
import * as api from '../js/api.js';
import { demoResponse } from '../examples/demo-response.mjs';

const date = '2026-10-03';
const now = new Date('2026-09-27T17:00:00Z');
function model() { return { ...demoResponse(date), demo: false, context: {} }; }
function contextResponse(url) {
  const name = new URL(url, 'http://localhost').pathname.split('/').at(-1);
  const context = demoResponse(date).context;
  context.events.event.name = 'API concert';
  context.weather.weather[36].rain = true;
  context.weather.weather[37].rain = true;
  return Response.json(context[name]);
}

test('fallback supplies fresh, aligned 48-slot volume and dwell profiles without invented context', () => {
  const fallback = data.createFallbackForecast(date);
  const next = data.createFallbackForecast('2026-10-04');
  for (const name of ['selectedDay', 'typicalDay']) {
    assert.equal(fallback[name].length, 48);
    assert.equal(fallback[name][0].time, '00:00');
    assert.equal(fallback[name][47].time, '23:30');
    assert.ok(fallback[name].every(row => Number.isFinite(row.volume) && row.volume >= 0 && Number.isFinite(row.dwellTime) && row.dwellTime >= 0));
    assert.equal(fallback.sources[name], 'fallback');
    assert.deepEqual(next[name], fallback[name]);
  }
  assert.deepEqual(fallback.context, {});
  fallback.selectedDay[0].volume = -1;
  assert.notEqual(next.selectedDay[0].volume, -1);
});

test('each valid model curve replaces only its own fallback and preserves real zero values', () => {
  const raw = model();
  raw.selectedDay[0].volume = 0;
  raw.typicalDay = null;
  const fallback = data.createFallbackForecast(date);
  const normalized = data.normalizeForecast(raw, date, { fallback });
  assert.equal(normalized.selectedDay[0].volume, 0);
  assert.equal(normalized.sources.selectedDay, 'model');
  assert.equal(normalized.sources.typicalDay, 'fallback');
  assert.deepEqual(normalized.typicalDay, fallback.typicalDay);
  assert.throws(() => data.normalizeForecast({ ...raw, date: '2026-10-04' }, date, { fallback }));
});

test('failed forecast retains fallback curves and real event, rain and holiday context', async () => {
  const snapshots = [];
  const result = await api.requestDay(date, { now, onUpdate: state => snapshots.push(state), fetchImpl: async url =>
    url.startsWith('/api/forecast') ? new Response('Unavailable', { status: 503 }) : contextResponse(url) });
  assert.equal(snapshots[0].selectedDay, null);
  assert.equal(snapshots[0].typicalDay, null);
  assert.equal(snapshots[0].sources.typicalDay, 'pending');
  assert.equal(snapshots[0].forecastPending, true);
  assert.equal(result.sources.selectedDay, 'fallback');
  assert.equal(result.sources.typicalDay, 'fallback');
  assert.match(result.forecastError, /503/);
  assert.equal(result.context.events.event.name, 'API concert');
  assert.equal(result.context.holiday.isHoliday, false);
  assert.equal(data.contextForSlot(result, 36).weather.title.includes('rain forecast'), true);
  assert.deepEqual(data.rainWindows(result.context.weather, date).map(({ startSlot, endSlot }) => [startSlot, endSlot]), [[36, 38]]);
});

test('context loads without demo curves while forecasts are pending, then real curves appear', async () => {
  let finishForecast, contextReady;
  const ready = new Promise(resolve => { contextReady = resolve; });
  const snapshots = [];
  const pending = api.requestDay(date, { now, onUpdate: state => {
    snapshots.push(state);
    if (state.context.weather && state.context.events) contextReady();
  }, fetchImpl: async url => url.startsWith('/api/forecast')
    ? new Promise(resolve => { finishForecast = resolve; }) : contextResponse(url) });
  await ready;
  const loading = snapshots.at(-1);
  const raw = model();
  finishForecast(Response.json(raw));
  const result = await pending;
  assert.equal(loading.forecastPending, true);
  assert.equal(loading.sources.selectedDay, 'pending');
  assert.equal(loading.selectedDay, null);
  assert.equal(loading.typicalDay, null);
  assert.equal(result.forecastPending, false);
  assert.equal(result.sources.selectedDay, 'model');
  assert.equal(result.sources.typicalDay, 'model');
  assert.deepEqual(result.selectedDay, raw.selectedDay);
  assert.equal(result.context.events.event.name, 'API concert');
});

test('one unavailable or wrong-date context response does not discard other successful inputs', async () => {
  const result = await api.requestDay(date, { now, fetchImpl: async url => {
    if (url.startsWith('/api/forecast')) return Response.json(model());
    if (url.startsWith('/api/weather')) return new Response('Unavailable', { status: 503 });
    if (url.startsWith('/api/holiday')) return Response.json({ date: '2026-10-04', isHoliday: true });
    return contextResponse(url);
  } });
  assert.equal(result.sources.selectedDay, 'model');
  assert.equal(result.context.weather, undefined);
  assert.equal(result.context.holiday, undefined);
  assert.equal(result.context.events.event.name, 'API concert');
  assert.match(data.contextForSlot(result, 36).weather.title, /unavailable/i);
});

test('latest loader ignores streaming updates from an old date, even when abort is ignored', async () => {
  const callbacks = new Map(), completions = new Map(), shown = [];
  const loader = api.createLatestLoader((day, { onUpdate }) => {
    callbacks.set(day, onUpdate);
    return new Promise(resolve => completions.set(day, resolve));
  });
  const first = loader.load(date, { onUpdate: value => shown.push(value) });
  const second = loader.load('2026-10-04', { onUpdate: value => shown.push(value) });
  callbacks.get(date)('stale');
  callbacks.get('2026-10-04')('current');
  completions.get(date)({ date });
  completions.get('2026-10-04')({ date: '2026-10-04' });
  assert.deepEqual(shown, ['current']);
  assert.equal((await first).stale, true);
  assert.equal((await second).stale, false);
});

test('rain windows merge adjacent wet slots, keep gaps, and include the final half-hour', () => {
  const weather = demoResponse(date).context.weather;
  for (const i of [0, 1, 3, 46, 47]) weather.weather[i].rain = true;
  const windows = data.rainWindows(weather, date);
  assert.deepEqual(windows.map(({ startSlot, endSlot }) => [startSlot, endSlot]), [[0, 2], [3, 4], [46, 48]]);
  assert.equal(windows.at(-1).endLabel, '24:00');
  assert.deepEqual(data.rainWindows(weather, '2026-10-04'), []);
  assert.deepEqual(data.rainWindows(null, date), []);
});

test('event boundaries distinguish continuation from a start or end inside the day', () => {
  const event = data.eventWindow({ name: 'Overnight', startTime: '2026-10-03T06:30:00Z', endTime: '2026-10-04T08:00:00Z' }, date);
  assert.equal(event.startSlot, 0);
  assert.equal(event.endSlot, 48);
  assert.equal(event.startsBeforeDay, true);
  assert.equal(event.endsAfterDay, true);
});

test('forecast timeout keeps usable fallback curves and already loaded context', async () => {
  const result = await api.requestDay(date, { now, timeoutMs: 5, fetchImpl: async (url, { signal }) => {
    if (!url.startsWith('/api/forecast')) return contextResponse(url);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  assert.match(result.forecastError, /timed out/i);
  assert.equal(result.forecastPending, false);
  assert.equal(result.selectedDay.length, 48);
  assert.equal(result.context.events.event.name, 'API concert');
});

test('malformed model JSON keeps both fallbacks, while a valid typical-only curve replaces its fallback', async () => {
  const invalid = await api.requestDay(date, { now, fetchImpl: async url => url.startsWith('/api/forecast')
    ? new Response('<html>bad gateway</html>') : contextResponse(url) });
  assert.equal(invalid.sources.selectedDay, 'fallback');
  assert.equal(invalid.sources.typicalDay, 'fallback');
  assert.equal(invalid.context.events.event.name, 'API concert');
  const raw = model();
  raw.selectedDay = null;
  const partial = await api.requestDay(date, { now, fetchImpl: async url => url.startsWith('/api/forecast')
    ? Response.json(raw) : contextResponse(url) });
  assert.equal(partial.sources.selectedDay, 'fallback');
  assert.equal(partial.sources.typicalDay, 'model');
  assert.deepEqual(partial.typicalDay, raw.typicalDay);
});

test('served typical volume is kept when only typical dwell is missing', () => {
  const raw = model();
  raw.typicalDay = raw.typicalDay.map(row => ({ ...row, volume: 91, dwellTime: null }));
  const fallback = data.createFallbackForecast(date);
  const value = data.normalizeForecast(raw, date, { fallback });
  assert.equal(value.typicalDay[0].volume, 91);
  assert.equal(value.typicalDay[0].dwellTime, fallback.typicalDay[0].dwellTime);
  assert.equal(value.sources.typicalDay, 'model');
  assert.equal(value.dwellSources.typicalDay, 'fallback');
  assert.equal(value.dwellSources.selectedDay, 'model');
});


test('late weather and event updates preserve the loaded Databricks baseline', async () => {
  const waiting = new Map(), snapshots = [];
  let markReady;
  const modelReady = new Promise(resolve => { markReady = resolve; });
  const raw = model();
  const pending = api.requestDay(date, { now, fetchImpl: async url => {
    if (url.startsWith('/api/forecast')) return Response.json(raw);
    return new Promise(resolve => waiting.set(url, resolve));
  }, onUpdate: state => {
    snapshots.push(state);
    if (!state.forecastPending) markReady();
  } });
  await modelReady;
  const loaded = snapshots.length - 1;
  for (const [url, resolve] of waiting) resolve(contextResponse(url));
  const result = await pending;
  for (const snapshot of snapshots.slice(loaded)) {
    assert.equal(snapshot.sources.typicalDay, 'model');
    assert.deepEqual(snapshot.typicalDay, raw.typicalDay);
    assert.deepEqual(data.smoothTypicalDay(snapshot).typicalDay, data.smoothTypicalDay(result).typicalDay);
  }
});

test('a failed baseline preserves selected data and explains why only the baseline uses demo data', async () => {
  const raw = model();
  raw.typicalDay = null;
  raw.projectionErrors = { typicalDay: 'Databricks request failed (HTTP 503).' };
  const result = await api.requestDay(date, { now, fetchImpl: async url => url.startsWith('/api/forecast')
    ? Response.json(raw) : contextResponse(url) });
  assert.equal(result.sources.selectedDay, 'model');
  assert.equal(result.sources.typicalDay, 'fallback');
  assert.match(result.forecastError, /Databricks.*503/);
});
