# Waterfront Crowd Forecast API: contract

Forecasts crowd **inflow** and **dwell time** in the Waterfront Station area for every 30-minute window of a requested date (48 windows per day), with a low / likely / high range.

- **Serving:** Databricks Model Serving (REST)
- **Model:** Unity Catalog `workspace.databricksxrogers.waterfront_crowd_forecast`
- **Endpoint:** `waterfront-crowd-forecast`
- **Typical-day endpoint:** `waterfront-crowd-forecast-dummy` uses the same serving contract. The selected-day endpoint serves the trained model; the trained response’s `usual_volume` supplies the baseline, with the dummy used only for missing baseline metrics.

The Next.js app must not call Databricks from the browser. `POST /api/forecast` forwards this payload. `GET /api/forecast?date=YYYY-MM-DD` gathers the existing context APIs and adapts these serving rows for the Waterfront page; see `transit-forecaster/public/waterfront/API-CONTRACT.md`. The GET adapter prefers the trained response’s `usual_volume` and optional `usual_dwell` for the baseline. The separate dummy endpoint fills only missing baseline metrics and cannot override usable trained values. The page uses fallback values only for unavailable volume or dwell fields; it smooths typical volume and adds explicitly labelled event/rain boosts to selected volume.

---

## Endpoint

```
POST https://<databricks-workspace-host>/serving-endpoints/waterfront-crowd-forecast/invocations
Authorization: Bearer <token>          # Databricks personal access token or service principal OAuth token
Content-Type: application/json
```

The caller needs **Can Query** permission on the endpoint.

---

## Request

A JSON object with `dataframe_records`: a list of rows. **One row per date is enough.** Add more rows for the same date only to give weather or events for specific 30-minute windows.

```json
{
  "dataframe_records": [
    {"date": "2026-09-12"},
    {"date": "2026-09-13", "slot_start": "2026-09-13T18:00:00", "rain": true, "temp_c": 14.5,
     "precip_mm": 1.2, "rain_mm": 1.2, "event_ids": ["large_canucks_game"]},
    {"date": "2026-09-13", "slot_start": "2026-09-13T18:30:00", "event_ids": ["large_canucks_game"]}
  ]
}
```

| Field | Type | Required | Meaning |
|---|---|---|---|
| `date` | string `YYYY-MM-DD` | **yes** | Day to forecast. Several dates per request are allowed. |
| `slot_start` | string, ISO 8601 datetime | no | Start of the 30-min window the inputs below apply to. **Local Vancouver clock time**, no time zone (`2026-09-13T18:00:00`). An offset like `+00:00` is ignored, not converted. Times are rounded down to the window start. |
| `rain` | boolean | no | Is it raining in that window |
| `temp_c` | number | no | Temperature, °C |
| `precip_mm` | number | no | Precipitation, mm |
| `rain_mm` | number | no | Rain, mm |
| `event_ids` | array of strings | no | Events affecting that window. **Each string must contain `holiday`, `large` or `small`** (e.g. `"large_canucks_game"`, `"small_farmers_market"`), which is how the model counts them. Other strings count as generic events. |

**Defaults for anything not supplied:**
- Weather: the typical value for that month and time of day.
- Events: none.
- BC statutory holidays are added automatically.

---

## Response

`{"predictions": [...]}` with **exactly 48 rows per requested date**, sorted by date and time.

```json
{
  "predictions": [
    {"date": "2026-09-13", "slot_start": "2026-09-13T18:00:00", "clock": "18:00",
     "volume_p10": 980.0, "volume_p50": 1150.0, "volume_p90": 1390.0,
     "dwell_p10": 22.0, "dwell_p50": 48.0, "dwell_p90": 115.0,
     "usual_volume": 870.0, "vs_usual_pct": 32.2, "level": "high",
     "model": "week_ahead", "confidence": "high", "is_holiday": 0,
     "events": ["large_canucks_game"]}
  ]
}
```

| Field | Type | Meaning |
|---|---|---|
| `date`, `slot_start`, `clock` | string | The window (local time), `clock` = `HH:MM` |
| `volume_p10` / `volume_p50` / `volume_p90` | number | **Device connections arriving** in the Waterfront area in that window: low / most likely / high. There's ~10% chance the real value is below p10 and ~10% above p90. Plan capacity against **p90**. |
| `dwell_p10` / `dwell_p50` / `dwell_p90` | number | Minutes those devices stay in the area (low / most likely / high) |
| `usual_volume` | number | The usual volume for this weekday + window (median of recent weeks, or of all history for far-off dates) |
| `vs_usual_pct` | number | `volume_p50` vs `usual_volume`, in %. `null` if usual is 0. |
| `level` | string | `high`: p50 ≥ busy threshold or ≥ 25% above usual · `watch`: p90 ≥ busy threshold or ≥ 10% above usual · `normal` |
| `model` | string | Which model answered (see below) |
| `confidence` | string | `high` · `medium` · `medium-low` · `low` |
| `is_holiday` | 0 / 1 | BC statutory holiday (or a holiday event was supplied) |
| `events` | array of strings | Events applied to that window |

**What `volume` is (and isn't):** anonymous counts of phones attaching to the Rogers cell tower that covers the Waterfront area. It is **not** unique people, not transit riders, and not people present at one moment. Use it as a measure of crowd inflow and, above all, of change vs usual.

---

## Which model answers

The service always returns 48 windows. It picks the most accurate model that has the history it needs:

| `model` | When | `confidence` |
|---|---|---|
| `week_ahead` | date ≤ 7 days after the last loaded data | high |
| `month_ahead` | date ≤ 35 days after the last loaded data | medium |
| `outlook` | anything later (e.g. 2027) | `medium-low` if that calendar month is in the training data, `low` otherwise (Sep/Oct) |

"Last loaded data" is fixed when the model version is packaged (currently the training data ends **2026-08-31**). In production, a daily job re-packages the model with fresh history so near-term dates keep using `week_ahead`.

---

## Errors

| Case | Result |
|---|---|
| Missing `date` or not `YYYY-MM-DD` | HTTP 400 with the validation message |
| Unknown / unmatched `event_ids` | Accepted; counted as generic events |
| Rows for windows outside the requested `date` | Ignored |
| Endpoint scaled to zero | First call can take ~30–60 s; retry with backoff |

---

## Examples

**curl (Databricks)**
```bash
curl -s -X POST "https://$DATABRICKS_HOST/serving-endpoints/waterfront-crowd-forecast/invocations" \
  -H "Authorization: Bearer $DATABRICKS_TOKEN" -H "Content-Type: application/json" \
  -d '{"dataframe_records": [{"date": "2026-09-12"}]}'
```

**curl (app)**
```bash
curl -s -X POST "http://localhost:3000/api/forecast" \
  -H "Content-Type: application/json" \
  -d '{"dataframe_records": [{"date": "2026-09-12"}]}'
```

**Python**
```python
import os, requests, pandas as pd
r = requests.post(
    f"https://{os.environ['DATABRICKS_HOST']}/serving-endpoints/waterfront-crowd-forecast/invocations",
    headers={"Authorization": f"Bearer {os.environ['DATABRICKS_TOKEN']}"},
    json={"dataframe_records": [{"date": "2026-09-12"},
                                {"date": "2026-09-13", "slot_start": "2026-09-13T18:00:00",
                                 "event_ids": ["large_canucks_game"]}]},
    timeout=60,
)
r.raise_for_status()
day = pd.DataFrame(r.json()["predictions"])     # 48 rows per date
```

---

## Versioning

- New training runs register a **new version** of the same UC model. The endpoint serves the version it's pointed at.
- The request and response fields above won't change within v1. New optional fields may be added to the response.
- To swap the dummy for the real model: log the new MLflow model to `workspace.databricksxrogers.waterfront_crowd_forecast`, then point `waterfront-crowd-forecast` at that version. The app route does not change.
