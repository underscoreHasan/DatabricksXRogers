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

Runs the static frontend with the real placeholder endpoint. Without the Next.js backend, it shows illustrative fallback curves. Independent context requires the Next.js API routes; the standalone server has no real weather, event, or holiday providers. Serve over HTTP, rather than opening index.html as a file.

## Connect your backend

1. Configure `DATABRICKS_HOST`, `DATABRICKS_TOKEN`, and optionally `DATABRICKS_SERVING_ENDPOINT` and `DATABRICKS_TYPICAL_SERVING_ENDPOINT` in the Next.js `.env.local`.
2. The implemented `GET /api/forecast?date=YYYY-MM-DD` adapter gathers context, calls Databricks, and returns the page contract in **API-CONTRACT.md**. The original `POST /api/forecast` serving contract is also available.
3. Selected-day values come from `volume_p50` / `dwell_p50` on `waterfront-crowd-forecast`. Typical volume comes from that trained response’s `usual_volume`, with optional `usual_dwell` for baseline dwell. The separate `waterfront-crowd-forecast-dummy` endpoint fills only missing baseline metrics using its medians. Source metadata and labels distinguish the trained baseline from this dummy fallback. `DATABRICKS_MODEL_KIND` defaults to `trained`; use `prototype` only when deliberately serving a prototype as the selected forecast.

The frontend is installed in `transit-forecaster/public/waterfront/`. Visit `/` or `/waterfront/index.html`; the default request goes to `/api/forecast` on that same origin. Do not copy the demo server into a Next.js route. For a separate backend origin, set an absolute endpoint URL and configure its CORS policy.

The frontend requests tomorrow on initial load and requests each newly selected valid date. Today/past dates are rejected in the UI and request function. Old requests are cancelled and stale responses ignored. Each missing or invalid volume or dwell field keeps its fixed fallback; valid fields replace only their own fallback. The trained baseline takes priority even when the dummy endpoint succeeds. A failed dummy cannot replace a usable trained baseline. Local demo fallback is used only for metrics neither source provides. Wrong dates or unsupported units reject the entire model response. The Retry button checks the model again.

## Fallback and context

The page shows a loading state until Databricks responds, while weather/event context can appear independently. A demo curve is used only after its forecast or metric fails. Each legend labels its source as Databricks, demo, or demo fallback, and failures remain visible in the status line. The fallback numbers live in `createFallbackForecast()` in `js/data.js`.

The page requests `/api/weather`, `/api/events`, and `/api/holiday` independently of the model. Failures remain unavailable rather than becoming dry weather, no event, or a non-holiday. Model-provided context can also be used; successful independent context takes precedence. Weekday display is calculated locally.

Orange timeline bands mark event coverage, with dashed start/end boundaries and estimated-end labels. Teal bands mark contiguous wet half-hours; historical data is labelled as a rainfall average. Bands and quick-jump buttons select their intervals, and context details update with the slider. The page adds the simple volume adjustments below to the selected-day curve as context arrives, including when the source is a fallback.

## Simple event and rain adjustments

After loading the source forecast, the page adds connections to selected-day volume for each affected half-hour. The event/rain adjustments affect neither the typical-day volume nor any dwell times.

- Small / medium / large event: **+100 / +200 / +300** connections during overlapping intervals (end time exclusive).
- Rain amount above 0 and below 1 mm: **+50**; 1 to below 4 mm: **+100**; 4 mm or more: **+150**. Uses the weather API's hourly `rain_mm` value for each half-hour, including historical averages when that is the available context.
- Event and rain boosts add together, up to **+450** per interval. Missing context adds nothing. Each render starts from the source volume, so updates never compound the boost.

These are simple display rules on top of the Databricks forecast (or demo fallback), not learned model effects. The sidebar shows the event/rain boost for the selected interval. Tune the amounts in `applyVolumeBoosts()` in `js/data.js`.

## Typical-day smoothing

The fallback dummy endpoint supplies one fixed Monday–Friday profile and one fixed weekend profile; dates within each group intentionally share a baseline. It does not provide seven distinct weekday profiles or seasonal variation, which is why a successful trained `usual_volume` must never be replaced with it.

Typical-day volume uses a centered moving average across five half-hour samples (the current slot and two neighbors on each side). Day edges use only the available samples, with no wrap across midnight. The legend marks this curve as smoothed; chart, map and comparison figures all use the same smoothed values. Selected-day detail and dwell values are preserved. Source values are retained so repeated renders do not compound the smoothing.

## Files

- `index.html`, `styles.css`: page structure and original design language.
- `js/app.js`: date selection, slider, playback, sidebar and event details.
- `js/visual.js`: map and selected/typical volume chart, using bundled D3.
- `js/api.js`: model request, independent context requests, and progressive loading.
- `js/data.js`: fixed fallback profiles, dates, validation, comparisons, event windows, and contiguous rain windows.
- `js/config.js`: endpoint, timeout and time convention.
- `examples/`: explicit demo generator and complete JSON response.
- `tests/`: run with `npm test`.

## Interpretation

The circle encodes site-level projected user volume; it does not show individual people, paths or within-site density. Dwell is displayed as average minutes. Base fallback volumes and dwell times are fixed illustrative values, identical across dates; selected-day volume can receive the display adjustments below. They are not model predictions. Real typical-day values should come from your backend. Smooth chart curves are a visual aid between the 48 discrete samples.

Weather, holiday and event details are accompanying context, **not model feature attribution**. They explain what is scheduled/forecast, not a proven cause of a numerical increase. The repo currently returns one selected qualifying event; a clear lookup does not imply there are no other events nearby.

All day slots use the backend's future-date UTC−07:00 convention. The offset is explicit in `js/config.js` to stay consistent with the supplied backend even on older browser timezone databases. Change frontend and backend together if your time convention changes.

Open `/waterfront/api-check.html` directly to inspect weather, events, weekday, and holiday responses independently. The date-based forecast adapter and the raw serving proxy are both implemented.
