import test from 'node:test';
import assert from 'node:assert/strict';
import { runChecks } from '../js/api-check-api.js';

const date = '2026-10-10';
const weekday = { date, dayOfWeek: 'Saturday', dayOfWeekNumber: 6 };
const events = { date, lookupStatus: 'partial', hasHighAttendanceEvent: null, event: null };

function responses(url) {
  const path = new URL(url, 'http://localhost').pathname;
  if (path === '/api/health') return Response.json({ status: 'ok', message: 'Backend is running.' });
  if (path === '/api/day-of-week') return Response.json(weekday);
  if (path === '/api/events') return Response.json(events);
  if (path === '/api/holiday') return Response.json({ date, isHoliday: false });
  return Response.json({ error: 'Weather provider unavailable.' }, { status: 503 });
}

test('returns each API result independently, preserving false, unknown and provider errors', async () => {
  const completed = [];
  const results = await runChecks(date, { fetchImpl: async url => responses(url), onResult: result => completed.push(result.id) });
  const byId = Object.fromEntries(results.map(result => [result.id, result]));
  assert.equal(results.length, 5);
  assert.equal(completed.length, 5);
  assert.equal(byId.health.state, 'ok');
  assert.equal(byId.dayOfWeek.data.dayOfWeekNumber, 6);
  assert.equal(byId.holiday.state, 'ok');
  assert.equal(byId.holiday.data.isHoliday, false);
  assert.equal(byId.events.state, 'partial');
  assert.equal(byId.events.data.hasHighAttendanceEvent, null);
  assert.equal(byId.weather.state, 'error');
  assert.equal(byId.weather.status, 503);
  assert.equal(byId.weather.data.error, 'Weather provider unavailable.');
  assert.match(byId.weather.error, /unavailable/i);
  assert.equal(byId.dayOfWeek.url, '/api/day-of-week?date=2026-10-10');
  assert.equal(byId.health.url, '/api/health');
});

test('a missing HTML route is reported as unavailable while other checks finish', async () => {
  const results = await runChecks(date, { fetchImpl: async url => url.startsWith('/api/holiday')
    ? new Response('<!doctype html><title>Not found</title>', { status: 404 }) : responses(url) });
  const holiday = results.find(result => result.id === 'holiday');
  assert.equal(holiday.state, 'error');
  assert.equal(holiday.status, 404);
  assert.match(holiday.error, /route.*not.*available/i);
  assert.equal(results.find(result => result.id === 'health').state, 'ok');
});

test('rejects impossible or missing dates before making requests', async () => {
  for (const invalid of ['', '2026-02-30', '2026-1-2', 'not-a-date']) {
    await assert.rejects(runChecks(invalid, { fetchImpl: () => assert.fail('No request expected') }), /valid.*date/i);
  }
});

test('does not mark malformed JSON, wrong dates, or incomplete weather as successful', async () => {
  const results = await runChecks(date, { fetchImpl: async url => {
    if (url.startsWith('/api/holiday')) return new Response('<html>wrong response</html>');
    if (url.startsWith('/api/day-of-week')) return Response.json({ ...weekday, date: '2026-10-11' });
    if (url.startsWith('/api/weather')) return Response.json({ date, n_slots: 48, weather: [] });
    return responses(url);
  } });
  for (const id of ['holiday', 'dayOfWeek', 'weather']) {
    assert.equal(results.find(result => result.id === id).state, 'error', id);
  }
});

test('a stalled request times out without losing completed checks', async () => {
  const results = await runChecks(date, { timeoutMs: 10, fetchImpl: async (url, { signal }) => {
    if (!url.startsWith('/api/weather')) return responses(url);
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
  } });
  assert.match(results.find(result => result.id === 'weather').error, /timed out/i);
  assert.equal(results.find(result => result.id === 'dayOfWeek').state, 'ok');
});
