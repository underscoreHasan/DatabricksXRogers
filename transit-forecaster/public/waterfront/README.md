# A day at Waterfront

Standalone HTML, CSS and JavaScript export of the approved visual. Preserves the map, palette, typography, two-column layout, comparison chart and playback controls. Added future-only date selection, backend loading/error states, dwell minutes, and event/weather context. No build step or API keys in the browser.

## Run with the app

From `transit-forecaster/`, run `npm run dev` and open http://localhost:3000. The frontend is served at `/waterfront/index.html`, with the existing API routes on the same origin.

## Standalone preview

Requires Node.js 20+; no npm install needed.

```sh
npm run demo
```

Open http://localhost:8080. This mode returns clearly labelled **illustrative demo data** for any future date; it does not call a model or real event/weather services.

```sh
npm start
```

Runs the static frontend with the real placeholder endpoint. Until you implement `/api/forecast`, it will show a setup error. Serve over HTTP, rather than opening index.html as a file.

## Connect your backend

1. Implement `GET /api/forecast?date=YYYY-MM-DD`, or change `forecastEndpoint` in `js/config.js`.
2. Fetch the downstream context and run your model on the server. Return selected-day and typical-day arrays plus context as documented in **API-CONTRACT.md**. A full sample is in `examples/forecast-response.json`.
3. If your model uses different field names, transform them in `mapBackendResponse()` in `js/api.js`.

The frontend is installed in `transit-forecaster/public/waterfront/`. Visit `/` or `/waterfront/index.html`; the default request goes to `/api/forecast` on that same origin. Do not copy the demo server into a Next.js route. For a separate backend origin, set an absolute endpoint URL and configure its CORS policy.

The frontend requests tomorrow on initial load and requests each newly selected valid date. Today/past dates are rejected in the UI and request function. Old requests are cancelled, stale responses ignored, and malformed/missing projections produce an error rather than invented data.

## Files

- `index.html`, `styles.css`: page structure and original design language.
- `js/app.js`: date selection, slider, playback, sidebar and event details.
- `js/visual.js`: map and selected/typical volume chart, using bundled D3.
- `js/api.js`: single placeholder request and response adapter.
- `js/data.js`: dates, validation, comparisons and event windows.
- `js/config.js`: endpoint, timeout and time convention.
- `examples/`: explicit demo generator and complete JSON response.
- `tests/`: run with `npm test`.

## Interpretation

The circle encodes site-level projected user volume; it does not show individual people, paths or within-site density. Dwell is displayed as average minutes. Typical-day values must come from your backend, not a frontend estimate. Smooth chart curves are a visual aid between the 48 discrete samples.

Weather, holiday and event details are accompanying context, **not model feature attribution**. They explain what is scheduled/forecast, not a proven cause of a numerical increase. The repo currently returns one selected qualifying event; a clear lookup does not imply there are no other events nearby.

All day slots use the backend's future-date UTC−07:00 convention. The offset is explicit in `js/config.js` to stay consistent with the supplied backend even on older browser timezone databases. Change frontend and backend together if your time convention changes.

Use **Test input APIs** on the main page to inspect weather, events, weekday, and holiday responses independently. The combined forecast endpoint remains to be implemented.
