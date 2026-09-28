export const CONFIG = Object.freeze({
  // Date-based adapter over the server-only Databricks serving request.
  forecastEndpoint: '/api/forecast',
  requestTimeoutMs: 80_000,
  timezone: 'America/Vancouver',
  // Matches the supplied backend's future-date UTC−7 convention, including on
  // browsers whose timezone database still applies the old autumn transition.
  utcOffsetMinutes: -420,
  dwellTimeUnit: 'minutes',
  playbackMs: 450,
  geometryUrl: new URL('../assets/waterfront-geometry.json', import.meta.url).href,
  location: { longitude: -123.1115, latitude: 49.2857 },
});
