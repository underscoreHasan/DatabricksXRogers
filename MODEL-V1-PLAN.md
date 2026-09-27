# Forecast model

This is only the **model** piece. The app still decides what to show and what actions to suggest.

We are **not** using live phone data. We are **not** using “how today has gone so far.”  
The operator (or the app) describes a stretch of time. The model answers: **for the next stretch of time, how busy and how stuck do we think Waterfront will be?**

Busy = how many pings. Stuck = how long people stay (dwell).

We predict **30-minute summaries** at Waterfront. The frontend can play those points on a map over time.

A simple “usual Tuesday at 5:30” average is the baseline. The model should beat that.

---

## Table we set up first

We build this ourselves in Databricks before training. **One row per 30 minutes at Waterfront:**

- time  
- day of week  
- how busy (count)  
- how stuck (dwell, e.g. average or typical)  
- weather for **that** 30 minutes (at least rain, maybe temperature)  
- which events apply to that bin (ids from the event list table below)

We also keep a **list of events** in Databricks. That is the only allowed set of event strings. The app reads this table and sends those strings in the forecast request. We do not invent extra labels in the API.

Example event list table (`event_id` is what the app sends):

| event_id | name |
| -------- | ---- |
| boxing_day | Boxing Day |
| canada_day | Canada Day |

If the 30-minute table is not done, we cannot train. If the event list is not done, the app has nothing to pick from.

---

## API contract

The frontend should **not** talk to Databricks directly. Call this from your backend (or a Databricks App). All times in **UTC**, ISO-8601.

**Idea:** one request = “start here, give me the next N slots, and here is the weather for those slots.”

Weather is **per slot**, covering the requested window — not one rain flag for the whole request.

`events` is a list of `event_id` values **copied from the Databricks event list**. Empty list = no special events. Same events for the whole request in this version. Unknown ids are an error.

The app should load the picker from Databricks (or `GET /v1/events`), not hard-code names.

### `GET /v1/events`

Returns the same rows as the event list table, so the UI stays in sync.

```json
{
  "events": [
    { "event_id": "boxing_day", "name": "Boxing Day" },
    { "event_id": "canada_day", "name": "Canada Day" }
  ]
}
```

### Request

`POST /v1/forecast`

```json
{
  "start_time": "2026-06-30T17:00:00Z",
  "n_slots": 4,
  "day_of_week": "tuesday",
  "weather": [
    { "time": "2026-06-30T17:00:00Z", "rain": true, "temp_c": 12 },
    { "time": "2026-06-30T17:30:00Z", "rain": true, "temp_c": 11 },
    { "time": "2026-06-30T18:00:00Z", "rain": false, "temp_c": 11 },
    { "time": "2026-06-30T18:30:00Z", "rain": false, "temp_c": 10 }
  ],
  "events": ["boxing_day"]
}
```


| Field         | Meaning                                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start_time`  | First 30-minute slot to predict. We floor to 30 minutes.                                                                                                                                      |
| `n_slots`     | How many steps to return (each step is 30 minutes). Example: 12 = 6 hours. Max 48 (one day).                                                                                                  |
| `day_of_week` | Optional if `start_time` is set (we can read it from the date). Include it if you are describing a *made-up* day.                                                                             |
| `weather`     | **Required.** One object per slot, in order, same length as `n_slots`. `time` must match `start_time`, then +30 minutes, and so on. `rain` is true/false for that slot. `temp_c` is optional. |
| `events`      | Optional. Each string must be an `event_id` from the Databricks event list. Empty list = none. Same events for the whole request.                                                            |


### Response

```json
{
  "model_version": "v1",
  "slot_minutes": 30,
  "baseline_used": "hour_of_week_average",
  "predictions": [
    {
      "site": "waterfront",
      "time": "2026-06-30T17:00:00Z",
      "predicted_volume": 4200,
      "predicted_dwell_minutes": 95,
      "usual_volume": 3800,
      "usual_dwell_minutes": 75,
      "busier_than_usual": true,
      "stuck_than_usual": true
    }
  ]
}
```


| Field                                    | Meaning                                                                                                                            |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `site`                                   | Always `waterfront`.                                                                                                               |
| `predicted_volume`                       | Guessed ping count for that 30 minutes.                                                                                            |
| `predicted_dwell_minutes`                | Guessed typical stay (minutes).                                                                                                    |
| `usual_*`                                | The simple average for Waterfront + weekday + time of day (the baseline). So the map can show “vs normal,” not only the raw guess. |
| `busier_than_usual` / `stuck_than_usual` | Convenience flags for the UI. Same rule we pick in training (e.g. clearly above usual).                                            |


**Errors**

- `400` — missing `start_time`, `n_slots`, or `weather`; `weather` length ≠ `n_slots`; `weather[].time` does not line up with the slots; `n_slots` out of range; `events` contains an id that is not in the Databricks event list
- `503` — model or warehouse not ready

One prediction per slot. For 12 slots, 12 objects. The frontend sorts by `time` and animates.

We can add `GET /v1/health` later (`{"ok": true, "model_version": "v1"}`).

---

## Plan (model work)

### 1. Build the 30-minute table

In Databricks: Waterfront pings → 30-minute bins (volume, dwell). Join weather **onto each bin** (rain/temp for that half hour). Create the event list table; join those events onto bins that fall on the right dates. Freeze column names. The app reads event ids from that table.

### 2. Build the baseline

For each weekday and 30-minute clock time at Waterfront, compute the usual volume and usual dwell. Save it. This is also what we return as `usual_*`.

### 3. Train

Inputs: weekday, time of day, rain for that slot, (optional) temperature for that slot, event flags.  
Outputs: volume and dwell for **that** slot.

Train/test split. Check we beat the baseline. If we do not, we still ship the baseline and say so.

Keep it a small model. No neural net unless the simple one is done and clearly weak.

### 4. Save the model

Write the trained model + the baseline table somewhere the API can read (Databricks volume or a small file). Record `model_version`.

### 5. Hand off to fullstack

Implement `GET /v1/events` and `POST /v1/forecast`. Reject event ids that are not in the table. For each of the N slots, use **that slot’s** weather, run the model, look up usual. Do not retrain on each request.

For the demo, we can also **precompute** a couple of showcase windows into a table so the map never waits on training.

Give them one example request/response (above). They stream by **timer**: every half second (or whatever) show the next `time`. They do not need live towers.

### 6. If there is extra time

- A note in the response when we have little training data for that combo (e.g. rain + rare event)  
- Not in scope: using “how the day has gone so far” — we do not have live data, and we are not doing that this round

---

## Open questions (small)

- Exact dwell number: average vs typical (median)? Pick one and stick to it.  
- Who hosts the API: Databricks App vs a small server in front of Databricks?

