import { CONFIG } from './config.js';
import { isFutureDate, normalizeForecast } from './data.js';

/**
 * BACKEND HANDOFF: change this function if your model uses different field names.
 * The required frontend shape is documented in API-CONTRACT.md.
 * Downstream weather/event/holiday/model calls stay entirely on your backend.
 */
export function mapBackendResponse(raw) {
  return raw;
}

export async function requestForecast(date, {
  signal, endpoint = CONFIG.forecastEndpoint, fetchImpl = globalThis.fetch,
  now = new Date(), timeoutMs = CONFIG.requestTimeoutMs,
} = {}) {
  if (!isFutureDate(date, now)) throw new Error('Choose a future date, starting tomorrow in Vancouver.');
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  try {
    // PLACEHOLDER CALL: GET /api/forecast?date=YYYY-MM-DD.
    // This is the only backend call performed by the frontend.
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
    return normalizeForecast(mapBackendResponse(raw), date);
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
    async load(date) {
      const ownGeneration = ++generation;
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await request(date, { signal: controller.signal });
        return ownGeneration === generation ? { stale: false, data } : { stale: true };
      } catch (error) {
        if (ownGeneration !== generation) return { stale: true };
        throw error;
      }
    },
    cancel() { ++generation; controller?.abort(); },
  };
}
