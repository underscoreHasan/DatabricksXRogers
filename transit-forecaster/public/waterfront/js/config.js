export const CONFIG = Object.freeze({
  // PLACEHOLDER: implement this endpoint or point it at your existing backend.
  forecastEndpoint: '/api/forecast',
  requestTimeoutMs: 30_000,
  timezone: 'America/Vancouver',
  // Matches the supplied backend's future-date UTC−7 convention, including on
  // browsers whose timezone database still applies the old autumn transition.
  utcOffsetMinutes: -420,
  dwellTimeUnit: 'minutes',
  playbackMs: 450,
  geometryUrl: new URL('../assets/waterfront-geometry.json', import.meta.url).href,
  location: { longitude: -123.1115, latitude: 49.2857 },
});
