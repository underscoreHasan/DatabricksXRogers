"""Dummy Waterfront crowd forecast packaged for Databricks Model Serving.

Scores are the usual weekday/clock average (p10 = p50 = p90). Weather and
events are parsed and echoed but do not change the numbers. Swap this for the
real model by logging a new version of
`workspace.databricksxrogers.waterfront_crowd_forecast` with the same
`predict()` contract, then pointing the serving endpoint at that version.
"""

from __future__ import annotations

import math
import re
from datetime import date, timedelta
from typing import Any

SLOT_MINUTES = 30
SLOTS_PER_DAY = 48
LAST_LOADED = date(2026, 8, 31)
BUSY_THRESHOLD = 1160.0
TRAINING_MONTHS = {1, 2, 3, 4, 5, 6, 7, 8, 11, 12}
MODEL_NAME = "workspace.databricksxrogers.waterfront_crowd_forecast"
ENDPOINT_NAME = "waterfront-crowd-forecast"

_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_SLOT = re.compile(
    r"^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?$"
)


class ForecastError(ValueError):
    """Invalid serving input. The app maps this to HTTP 400."""


def is_calendar_date(value: str) -> bool:
    if not _DATE.match(value):
        return False
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        return False
    return parsed.isoformat() == value


def _omitted(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, float) and math.isnan(value):
        return True
    name = type(value).__name__
    return name in {"NAType", "NaTType"}


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def _easter(year: int) -> date:
    a = year % 19
    b, c = divmod(year, 100)
    d, e = divmod(b, 4)
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = divmod(c, 4)
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month, day = divmod(h + l - 7 * m + 114, 31)
    return date(year, month, day + 1)


def _observed(day: date) -> date:
    return day + timedelta(days=1) if day.weekday() == 6 else day


def bc_holidays(year: int) -> set[date]:
    victoria = date(year, 5, 24) - timedelta(days=date(year, 5, 24).weekday())
    return {
        _observed(date(year, 1, 1)),
        _nth_weekday(year, 2, 0, 3),
        _easter(year) - timedelta(days=2),
        victoria,
        _observed(date(year, 7, 1)),
        _nth_weekday(year, 8, 0, 1),
        _nth_weekday(year, 9, 0, 1),
        _observed(date(year, 9, 30)),
        _nth_weekday(year, 10, 0, 2),
        _observed(date(year, 11, 11)),
        _observed(date(year, 12, 25)),
        _observed(date(year, 12, 26)),
    }


def event_counts(event_ids: list[str]) -> dict[str, int]:
    counts = {"holiday": 0, "large": 0, "small": 0, "other": 0}
    for event_id in event_ids:
        key = next((kind for kind in ("holiday", "large", "small") if kind in event_id.lower()), "other")
        counts[key] += 1
    return counts


def horizon(day: date) -> tuple[str, str]:
    delta = (day - LAST_LOADED).days
    if delta <= 7:
        return "week_ahead", "high"
    if delta <= 35:
        return "month_ahead", "medium"
    if day.month in TRAINING_MONTHS:
        return "outlook", "medium-low"
    return "outlook", "low"


def usual_volume(slot: int, weekend: bool) -> float:
    hour = slot / 2
    if weekend:
        return round(180 + 520 * max(0.0, math.sin(max(0.0, hour - 7) / 14 * math.pi)), 1)
    am = math.exp(-((hour - 8.5) ** 2) / 2.0)
    pm = math.exp(-((hour - 17.0) ** 2) / 2.8)
    midday = 0.35 * max(0.0, math.sin((hour - 6) / 16 * math.pi))
    night = 0.12 if hour < 6 or hour >= 22 else 0.0
    return round(160 + 1100 * (am + pm) + 700 * midday + 80 * night, 1)


def usual_dwell(slot: int) -> float:
    hour = slot / 2
    return round(48 + 8 * max(0.0, math.sin((hour - 8) / 16 * math.pi)), 1)


def _parse_slot_start(value: Any) -> tuple[str, int] | None:
    if _omitted(value):
        return None
    if not isinstance(value, str):
        raise ForecastError("slot_start must be an ISO 8601 datetime.")
    match = _SLOT.match(value)
    if not match:
        raise ForecastError("slot_start must be an ISO 8601 datetime.")
    day, hour, minute = match.group(1), int(match.group(2)), int(match.group(3))
    if not is_calendar_date(day):
        raise ForecastError("slot_start must be an ISO 8601 datetime.")
    return day, hour * 2 + minute // SLOT_MINUTES


def _parse_event_ids(value: Any) -> list[str] | None:
    if _omitted(value):
        return None
    if hasattr(value, "tolist"):
        value = value.tolist()
    if not isinstance(value, (list, tuple)) or any(not isinstance(item, str) for item in value):
        raise ForecastError("event_ids must be an array of strings.")
    return [item for item in value]


def _parse_weather(row: dict[str, Any]) -> dict[str, Any]:
    weather: dict[str, Any] = {}
    if not _omitted(row.get("rain")):
        if not isinstance(row["rain"], bool) and type(row["rain"]).__name__ not in {"bool_", "Boolean"}:
            raise ForecastError("rain must be a boolean.")
        weather["rain"] = bool(row["rain"])
    for field in ("temp_c", "precip_mm", "rain_mm"):
        if _omitted(row.get(field)):
            continue
        if not _finite(row[field]):
            raise ForecastError(f"{field} must be a finite number.")
        weather[field] = float(row[field])
    return weather


def parse_records(records: Any) -> list[dict[str, Any]]:
    if not isinstance(records, list) or not records:
        raise ForecastError("dataframe_records must be a non-empty list.")
    parsed: list[dict[str, Any]] = []
    for index, raw in enumerate(records):
        if not isinstance(raw, dict):
            raise ForecastError(f"dataframe_records[{index}] must be an object.")
        day = raw.get("date")
        if not isinstance(day, str) or not is_calendar_date(day):
            raise ForecastError("Missing date or not YYYY-MM-DD.")
        slot = _parse_slot_start(raw.get("slot_start"))
        if slot and slot[0] != day:
            parsed.append({"date": day, "slot": None, "weather": {}, "event_ids": None, "ignored": True})
            continue
        parsed.append({
            "date": day,
            "slot": None if slot is None else slot[1],
            "weather": _parse_weather(raw),
            "event_ids": _parse_event_ids(raw.get("event_ids")),
            "ignored": False,
        })
    if not parsed:
        raise ForecastError("Missing date or not YYYY-MM-DD.")
    return parsed


def _score_slot(day: date, slot: int, events: list[str]) -> dict[str, Any]:
    weekend = day.weekday() >= 5
    statutory = day in bc_holidays(day.year)
    counts = event_counts(events)
    holiday = statutory or counts["holiday"] > 0
    if statutory and not any("holiday" in event_id.lower() for event_id in events):
        events = ["holiday", *events]
    volume = usual_volume(slot, weekend)
    dwell = usual_dwell(slot)
    model, confidence = horizon(day)
    hour, minute = divmod(slot * SLOT_MINUTES, 60)
    clock = f"{hour:02d}:{minute:02d}"
    return {
        "date": day.isoformat(),
        "slot_start": f"{day.isoformat()}T{clock}:00",
        "clock": clock,
        "volume_p10": volume,
        "volume_p50": volume,
        "volume_p90": volume,
        "dwell_p10": dwell,
        "dwell_p50": dwell,
        "dwell_p90": dwell,
        "usual_volume": volume,
        "vs_usual_pct": 0.0,
        "level": "high" if volume >= BUSY_THRESHOLD else "normal",
        "model": model,
        "confidence": confidence,
        "is_holiday": int(holiday),
        "events": events,
    }


def forecast(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    parsed = parse_records(records)
    day_defaults: dict[str, dict[str, Any]] = {}
    slot_overrides: dict[str, dict[int, dict[str, Any]]] = {}
    order: list[str] = []
    for row in parsed:
        day = row["date"]
        if day not in order:
            order.append(day)
            slot_overrides[day] = {}
        if row.get("ignored"):
            continue
        if row["slot"] is None:
            day_defaults[day] = row
        else:
            slot_overrides[day][row["slot"]] = row
    predictions: list[dict[str, Any]] = []
    for day_str in sorted(order):
        day = date.fromisoformat(day_str)
        base = day_defaults.get(day_str, {"weather": {}, "event_ids": None})
        for slot in range(SLOTS_PER_DAY):
            override = slot_overrides[day_str].get(slot, {})
            events = override["event_ids"] if override.get("event_ids") is not None else base.get("event_ids") or []
            predictions.append(_score_slot(day, slot, list(events)))
    return predictions


def dataframe_to_records(model_input: Any) -> list[dict[str, Any]]:
    if isinstance(model_input, list):
        return model_input
    if hasattr(model_input, "to_dict"):
        return model_input.to_dict(orient="records")
    raise ForecastError("Request must be a JSON object with dataframe_records.")


def score_dataframe(model_input: Any):
    import pandas as pd

    return pd.DataFrame(forecast(dataframe_to_records(model_input)))


try:
    import mlflow.pyfunc

    class WaterfrontCrowdModel(mlflow.pyfunc.PythonModel):
        def predict(self, context, model_input, params=None):
            try:
                return score_dataframe(model_input)
            except ForecastError as error:
                raise ValueError(str(error)) from error
except ImportError:  # local unit tests do not need mlflow
    WaterfrontCrowdModel = None  # type: ignore[misc, assignment]


def register(model_name: str = MODEL_NAME) -> None:
    import mlflow
    import pandas as pd

    if WaterfrontCrowdModel is None:
        raise RuntimeError("mlflow is required to register the dummy model.")
    WaterfrontCrowdModel.__module__ = "dummy_forecast"
    mlflow.set_tracking_uri("databricks")
    mlflow.set_registry_uri("databricks-uc")
    try:
        from databricks.sdk import WorkspaceClient
        user = WorkspaceClient().current_user.me().user_name
        experiment = f"/Users/{user}/waterfront-dummy-forecast"
    except Exception:
        experiment = "/Shared/waterfront-dummy-forecast"
    mlflow.set_experiment(experiment)
    example = pd.DataFrame([{"date": "2026-09-12"}])
    with mlflow.start_run(run_name="waterfront-dummy"):
        info = mlflow.pyfunc.log_model(
            artifact_path="model",
            python_model=WaterfrontCrowdModel(),
            registered_model_name=model_name,
            input_example=example,
            pip_requirements=["pandas>=2.0,<3"],
        )
    print(f"registered {model_name} uri={info.model_uri}")


if __name__ == "__main__":
    register()
