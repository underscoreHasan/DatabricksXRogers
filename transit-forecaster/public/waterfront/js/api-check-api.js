import { isCalendarDate, slotLabel } from './data.js';

export const ENDPOINTS = [
  { id: 'weather', label: 'Weather', path: '/api/weather', source: 'Open-Meteo' },
  { id: 'events', label: 'Events', path: '/api/events', source: 'Ticketmaster' },
  { id: 'dayOfWeek', label: 'Day of week', path: '/api/day-of-week', source: 'Internal calculation' },
  { id: 'holiday', label: 'Holiday', path: '/api/holiday', source: 'Canada Holidays · B.C.' },
  { id: 'health', label: 'Backend health', path: '/api/health', source: 'Connection check' },
];

function validate(id, data, date) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected a JSON object.');
  if (data.error) throw new Error(String(data.error));
  if (id !== 'health' && data.date !== date) throw new Error('Response date does not match the selected date.');
  if (id === 'weather' && (data.n_slots !== 48 || !Array.isArray(data.weather) || data.weather.length !== 48
    || data.weather.some((row, i) => !row || row.time_local?.slice(0, 16) !== `${date}T${slotLabel(i)}`
      || !Number.isFinite(Date.parse(row.time)) || typeof row.rain !== 'boolean'
      || !['temp_c', 'precip_mm', 'rain_mm'].every(key => typeof row[key] === 'number' && Number.isFinite(row[key]))))) {
    throw new Error('Expected 48 complete weather rows, ordered 00:00 through 23:30 for the selected date.');
  }
  if (id === 'dayOfWeek' && (typeof data.dayOfWeek !== 'string' || !Number.isInteger(data.dayOfWeekNumber)
    || data.dayOfWeekNumber < 1 || data.dayOfWeekNumber > 7)) throw new Error('Invalid weekday response.');
  if (id === 'holiday' && typeof data.isHoliday !== 'boolean') throw new Error('Missing holiday flag.');
  if (id === 'events' && !['ok', 'partial'].includes(data.lookupStatus)) throw new Error('Event lookup is unavailable.');
  if (id === 'health' && data.status !== 'ok') throw new Error('Backend did not report a healthy status.');
}

export async function runChecks(date, { fetchImpl = fetch, onResult = () => {}, timeoutMs = 20_000 } = {}) {
  if (!isCalendarDate(date)) throw new Error('Enter a valid calendar date as YYYY-MM-DD.');
  return Promise.all(ENDPOINTS.map(async endpoint => {
    const url = endpoint.path + (endpoint.id === 'health' ? '' : `?date=${encodeURIComponent(date)}`);
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const result = { ...endpoint, url, state: 'error', status: null, data: null, error: null, elapsedMs: 0 };
    try {
      const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store' });
      result.status = response.status;
      const body = await response.text();
      try { result.data = JSON.parse(body); } catch { /* Report HTML and invalid JSON below. */ }
      if (response.status === 404) throw new Error('This API route is not available on the running server.');
      if (!response.ok) throw new Error(result.data?.error || `Request failed with HTTP ${response.status}.`);
      validate(endpoint.id, result.data, date);
      result.state = endpoint.id === 'events' && result.data.lookupStatus === 'partial' ? 'partial' : 'ok';
    } catch (error) {
      result.error = controller.signal.aborted ? 'Request timed out. Try again.' : error.message || 'Request failed.';
    } finally {
      clearTimeout(timer);
      result.elapsedMs = Date.now() - started;
    }
    onResult(result);
    return result;
  }));
}
