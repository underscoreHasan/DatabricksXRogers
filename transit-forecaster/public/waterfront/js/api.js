import { CONFIG } from './config.js';
import { isFutureDate, normalizeForecast, createFallbackForecast, slotLabel } from './data.js';

/**
 * BACKEND HANDOFF: change this function if your model uses different field names.
 * The required frontend shape is documented in API-CONTRACT.md.
 * Provider credentials and model calls stay on the backend; context uses same-origin API routes.
 */
export function mapBackendResponse(raw) {
  return raw;
}

export async function requestForecast(date, {
  signal, endpoint = CONFIG.forecastEndpoint, fetchImpl = globalThis.fetch,
  now = new Date(), timeoutMs = CONFIG.requestTimeoutMs, fallback,
} = {}) {
  if (!isFutureDate(date, now)) throw new Error('Choose a future date, starting tomorrow in Vancouver.');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    // Date-based adapter calls both Databricks serving endpoints.
    const separator = endpoint.includes('?') ? '&' : '?';
    const response = await fetchImpl(`${endpoint}${separator}${new URLSearchParams({ date })}`, {
      method: 'GET', headers: { Accept: 'application/json' },
      signal: controller.signal, cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error('Forecast endpoint not connected (HTTP 404). Configure forecastEndpoint in js/config.js.');
      throw new Error(`The forecast request failed (HTTP ${response.status}). Please try again.`);
    }
    let raw;
    try { raw = await response.json(); }
    catch { throw new Error('The forecast endpoint must return JSON. See API-CONTRACT.md.'); }
    return normalizeForecast(mapBackendResponse(raw), date, { fallback });
  } catch (error) {
    if (timedOut) throw new Error('The forecast request timed out. Please try again.');
    if (error instanceof TypeError) throw new Error('Cannot reach the forecast backend. Check its URL and CORS configuration.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Cancel superseded requests and ignore late results, even if abort is ignored. */
export function createLatestLoader(request = requestForecast) {
  let generation = 0, controller;
  return {
    async load(date, { onUpdate = () => {} } = {}) {
      const ownGeneration = ++generation;
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await request(date, {
          signal: controller.signal,
          onUpdate: value => { if (ownGeneration === generation) onUpdate(value); },
        });
        return ownGeneration === generation ? { stale: false, data } : { stale: true };
      } catch (error) {
        if (ownGeneration !== generation) return { stale: true };
        throw error;
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}

const CONTEXT_ENDPOINTS = { weather: '/api/weather', events: '/api/events', holiday: '/api/holiday' };

async function requestContext(kind, date, { signal, fetchImpl, contextTimeoutMs = 15_000 }) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, contextTimeoutMs);
  try {
    const response = await fetchImpl(`${CONTEXT_ENDPOINTS[kind]}?${new URLSearchParams({ date })}`, {
      signal: controller.signal, cache: 'no-store', headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`${kind} lookup unavailable (HTTP ${response.status}).`);
    const value = await response.json();
    if (!value || value.date !== date) throw new Error(`${kind} response date does not match the selected day.`);
    if (kind === 'weather' && (!Array.isArray(value.weather) || value.weather.length !== 48 || value.weather.some((row, i) =>
      !row || row.time_local?.slice(0, 16) !== `${date}T${slotLabel(i)}` || !Number.isFinite(row.temp_c) || typeof row.rain !== 'boolean'))) {
      throw new Error('Weather response has incomplete or misaligned intervals.');
    }
    if (kind === 'events' && !['ok', 'partial'].includes(value.lookupStatus)) throw new Error('Event lookup unavailable.');
    if (kind === 'holiday' && typeof value.isHoliday !== 'boolean') throw new Error('Holiday status unavailable.');
    return value;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

/** Load context independently; use demo curves only after a forecast failure. */
export async function requestDay(date, options = {}) {
  const { now = new Date(), signal, fetchImpl = globalThis.fetch, onUpdate = () => {} } = options;
  if (!isFutureDate(date, now)) throw new Error('Choose a future date, starting tomorrow in Vancouver.');
  const fallback = createFallbackForecast(date);
  let state = { ...fallback, selectedDay: null, typicalDay: null,
    sources: { selectedDay: 'pending', typicalDay: 'pending' },
    dwellSources: { selectedDay: 'pending', typicalDay: 'pending' },
    forecastPending: true, contextPending: true, forecastError: null, contextErrors: {} };
  const publish = patch => {
    state = { ...state, ...patch };
    if (!signal?.aborted) onUpdate(state);
  };
  publish({});
  const forecastTask = requestForecast(date, { ...options, fetchImpl, fallback }).then(value => {
    publish({ ...value, context: { ...value.context, ...state.context }, forecastPending: false,
      forecastError: Object.values(value.projectionErrors).join(' ') || null });
  }, error => publish({ ...fallback, context: state.context, forecastPending: false, forecastError: error.message }));
  const contextTasks = Object.keys(CONTEXT_ENDPOINTS).map(async kind => {
    try {
      const value = await requestContext(kind, date, { ...options, signal, fetchImpl });
      publish({ context: { ...state.context, [kind]: value } });
    } catch (error) {
      publish({ contextErrors: { ...state.contextErrors, [kind]: error.message } });
    }
  });
  await Promise.all([forecastTask, Promise.all(contextTasks).then(() => publish({ contextPending: false }))]);
  return state;
}
