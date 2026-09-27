# Databricks notebook source
# MAGIC %md
# MAGIC # Waterfront Crowd Forecast: XGBoost (week-ahead + month-ahead)
# MAGIC
# MAGIC **What it predicts:** crowd size in the Waterfront area (`volume` = device connections per slot), with a **p10 / p50 / p90** range so TransLink dispatch can plan for the high end.
# MAGIC
# MAGIC | Model | Used for | History it may use | Weather |
# MAGIC |---|---|---|---|
# MAGIC | **week_ahead** | days 1–7 (operations) | same slot ≥ 7 days ago | ✅ |
# MAGIC | **month_ahead** | days 8–30 (planning) | same slot ≥ 35 days ago | ❌ (not forecastable a month out) |
# MAGIC
# MAGIC **Backtest:** train Nov 2025 – Jun 2026, test Jul – Aug 2026 (never seen in training).
# MAGIC
# MAGIC **Rules that keep the backtest honest:**
# MAGIC * Same-slot dwell (`dwell_minutes`, `mean_…`, `p90_…`) is **not** an input: it's only known after the slot ends.
# MAGIC * `usual_volume` / `usual_dwell_minutes` are **not** inputs: section 1 checks whether they were averaged over the whole period (which would leak the future). The model builds its own past-only baselines instead.
# MAGIC * Every history feature is at least the horizon old.
# MAGIC
# MAGIC | # | Section |
# MAGIC |---|---|
# MAGIC | 0 | Setup |
# MAGIC | 1 | Load + checks (slot size, gaps, events, leakage) |
# MAGIC | 2 | Features per horizon |
# MAGIC | 3 | Backtest: train Nov–Jun, test Jul–Aug |
# MAGIC | 4 | Backtest charts + feature importance |
# MAGIC | 4c | Jul + Aug: forecast vs real data vs same time last month |
# MAGIC | 5 | Final models on all data → next 30 days, with 7-day and 30-day plots + vs last month |
# MAGIC | 5c | **Any-date predictor**: `predict_day(date, inputs)` → 48 × 30-min volume + dwell (p10/p50/p90) |
# MAGIC | 6 | Export `forecast.json` + Delta tables |
# MAGIC | 7 | Log models, close the MLflow run |
# MAGIC
# MAGIC **MLflow:** the whole notebook runs inside **one MLflow run**. Every chart (PNG, or interactive HTML for Plotly), every metrics table (CSV), the forecast (`forecast.json` + CSV) and both models are logged to it, under these folders:
# MAGIC `data_checks/` · `backtest/` · `metrics/` · `feature_importance/` · `monthly/` · `forecast/` · `models/`

# COMMAND ----------

# MAGIC %pip install -q "xgboost>=2.0" plotly

# COMMAND ----------

# MAGIC %restart_python

# COMMAND ----------

# MAGIC %md
# MAGIC ## 0. Setup

# COMMAND ----------

import json, os, datetime as dt
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.ticker as mtick
import matplotlib.dates as mdates
import plotly.graph_objects as go
from plotly.subplots import make_subplots
import xgboost as xgb
from builtins import min, max, sum, abs, round

# ---------------- CONFIG ----------------
FEATURE_TABLE = "workspace.databricksxrogers.gold_waterfront_bins_30m_with_events"
GOLD_SCHEMA = "workspace.databricksxrogers"
TRAIN_END = "2026-06-30"                               # backtest: train ≤ this date
TEST_START = "2026-07-01"                              # backtest: test from this date (Jul–Aug)
HORIZONS = {"week_ahead": 7, "month_ahead": 35}        # days; multiples of 7 so lags land on the same weekday; 35 ≥ 30-day window
FORECAST_DAYS = 30                                     # days 1–7 from week_ahead, 8–30 from month_ahead
QUANTILES = [0.1, 0.5, 0.9]
BUSY_Q = 0.9                                           # busy slot = top 10% of training volume
WEATHER_COLS = ["rain", "temp_c", "precip_mm", "rain_mm"]
OUTPUT_DIR = "."                                       # forecast.json is written next to this notebook

# Event categories. If event_ids are opaque ids, point EVENTS_TABLE at the table that maps id -> category.
EVENTS_TABLE = None                                    # e.g. "rogersdatabricks.gold.events"
EVENT_ID_COL, EVENT_CAT_COL = "event_id", "category"
CATEGORIES = ["holiday", "large", "small"]            # anything else counts as "other"

# Future inputs for the forecast window (from the events agent / weather forecast). Empty = none known.
FUTURE_HOLIDAYS = {"2026-09-07": "Labour Day", "2026-09-30": "National Day for Truth and Reconciliation"}
FUTURE_EVENTS = []      # [{"date": "2026-09-12", "start": "18:00", "end": "23:00", "category": "large", "name": "..."}]
FUTURE_WEATHER = None   # optional pandas DataFrame: slot_start + WEATHER_COLS; otherwise recent same-slot averages are used

# MLflow
EXPERIMENT = "/Users/manikanthgoud98@gmail.com/waterfront_crowd_forecast"
       # e.g. "/Users/<you>/waterfront_forecast"; None = this notebook's own experiment
RUN_NAME = f"waterfront_xgb_{dt.datetime.now():%Y%m%d_%H%M}_dwell"
LAST_MONTH_DAYS = 28    # "same time last month" = same weekday + slot 4 weeks earlier (35 if 28 isn't available)
# ----------------------------------------

spark.conf.set("spark.sql.session.timeZone", "UTC")
plt.rcParams.update({"figure.figsize": (14, 5), "axes.spines.top": False, "axes.spines.right": False,
                     "axes.titleweight": "bold"})
print("xgboost", xgb.__version__)

# COMMAND ----------

# One MLflow run for the whole notebook: every plot, table and model below is logged into it
import re, tempfile
import mlflow

if EXPERIMENT:
    mlflow.set_experiment(EXPERIMENT)
mlflow.end_run()                                   # close a run left open by an earlier failed attempt
run = mlflow.start_run(run_name=RUN_NAME)
ART_DIR = tempfile.mkdtemp()

def log_fig(fig, path):
    """Matplotlib -> PNG, Plotly -> interactive HTML, logged to the active run."""
    ext = ".html" if hasattr(fig, "to_html") else ".png"
    path = path if path.endswith(ext) else path + ext
    try:
        mlflow.log_figure(fig, path)
    except Exception as e:
        print(f"⚠ could not log {path}: {e}")

def show_and_log(fig, path):
    fig.tight_layout()
    log_fig(fig, path)
    plt.show()

def log_df(pdf, path):
    local = os.path.join(ART_DIR, path.replace("/", "__"))
    pdf.to_csv(local, index=False)
    folder, _ = os.path.split(path)
    try:
        mlflow.log_artifact(local, artifact_path=folder or None)
    except Exception as e:
        print(f"⚠ could not log {path}: {e}")

def metric_key(*parts):
    return re.sub(r"[^A-Za-z0-9_\-./ ]+", "_", "/".join(str(p) for p in parts))

def log_metric_table(table, prefix):
    vals = {metric_key(prefix, idx, col): float(v) for idx, r in table.iterrows() for col, v in r.items()
            if isinstance(v, (int, float, np.number)) and pd.notna(v)}
    mlflow.log_metrics(vals)

mlflow.log_params({"feature_table": FEATURE_TABLE, "train_end": TRAIN_END, "test_start": TEST_START,
                   "horizons": json.dumps(HORIZONS), "forecast_days": FORECAST_DAYS, "quantiles": str(QUANTILES),
                   "busy_quantile": BUSY_Q, "weather_cols": ",".join(WEATHER_COLS)})
print(f"MLflow run {run.info.run_id} ({RUN_NAME}) started: open it from the Experiments icon in the right sidebar")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 1. Load + checks

# COMMAND ----------

raw = spark.table(FEATURE_TABLE).toPandas()
print(f"{len(raw):,} rows, columns: {list(raw.columns)}")

df = raw.copy()
df["slot_start"] = pd.to_datetime(df["slot_start"], utc=True).dt.tz_localize(None)
df = df.sort_values("slot_start").drop_duplicates("slot_start").reset_index(drop=True)

SLOT_MIN = int(df["slot_start"].diff().dropna().mode()[0].total_seconds() // 60)
SPD = 1440 // SLOT_MIN                                  # slots per day
full_idx = pd.date_range(df["slot_start"].min(), df["slot_start"].max(), freq=f"{SLOT_MIN}min")
missing = full_idx.difference(df["slot_start"])
print(f"slot size {SLOT_MIN} min ({SPD}/day) | {df['slot_start'].min()} → {df['slot_start'].max()} | missing slots: {len(missing)}")

# Contiguous grid so shift(n) = n slots back. Missing slots: volume 0 (no connections), weather carried forward.
df = df.set_index("slot_start").reindex(full_idx).rename_axis("slot_start").reset_index()
df["volume"] = df["volume"].fillna(0)
df[WEATHER_COLS] = df[WEATHER_COLS].ffill()
df["rain"] = df["rain"].astype(float)

# COMMAND ----------

# Events: parse event_ids and turn them into counts per category
def to_list(v):
    if v is None or (isinstance(v, float) and np.isnan(v)):
        return []
    if isinstance(v, (list, tuple, np.ndarray)):
        return [str(x) for x in v]
    s = str(v).strip()
    if s in ("", "[]"):
        return []
    try:
        return [str(x) for x in json.loads(s)]
    except Exception:
        return [x.strip(" '\"") for x in s.strip("[]").split(",") if x.strip()]

df["event_list"] = df["event_ids"].map(to_list)
ids = pd.Series([e for l in df["event_list"] for e in l])
print(f"slots with ≥1 event: {(df['event_list'].map(len) > 0).mean():.1%} | distinct ids: {ids.nunique()}")
display(ids.value_counts().head(25).rename_axis("event_id").reset_index(name="slots"))
log_df(ids.value_counts().rename_axis("event_id").reset_index(name="slots"), "data_checks/event_ids.csv")

CAT_MAP = {}
if EVENTS_TABLE:
    ev = spark.table(EVENTS_TABLE).select(EVENT_ID_COL, EVENT_CAT_COL).toPandas()
    CAT_MAP = dict(zip(ev[EVENT_ID_COL].astype(str), ev[EVENT_CAT_COL].astype(str).str.lower()))

def categorize(eid):
    e = CAT_MAP.get(eid, eid).lower()
    return next((c for c in CATEGORIES if c in e), "other")

def add_event_counts(f):
    for c in CATEGORIES + ["other"]:
        f[f"n_{c}"] = f["event_list"].map(lambda l: sum(categorize(e) == c for e in l))
    f["n_events"] = f["event_list"].map(len)
    f["is_holiday"] = (f["n_holiday"] > 0).astype(int)
    return f

df = add_event_counts(df)
display(df[[f"n_{c}" for c in CATEGORIES + ["other"]]].gt(0).mean().rename("share_of_slots").reset_index())
if df["n_other"].sum() > 0 and df[[f"n_{c}" for c in CATEGORIES]].sum().sum() == 0:
    print("⚠ No ids matched holiday/large/small: set EVENTS_TABLE (id -> category) so events become useful features.")

# COMMAND ----------

def add_calendar(f):
    t = f["slot_start"]
    f["date"] = t.dt.normalize()
    f["hour"] = t.dt.hour
    f["sod"] = (t.dt.hour * 60 + t.dt.minute) // SLOT_MIN
    f["dow"] = t.dt.dayofweek
    f["is_weekend"] = (f["dow"] >= 5).astype(int)
    f["sod_sin"], f["sod_cos"] = np.sin(2 * np.pi * f["sod"] / SPD), np.cos(2 * np.pi * f["sod"] / SPD)
    f["dow_sin"], f["dow_cos"] = np.sin(2 * np.pi * f["dow"] / 7), np.cos(2 * np.pi * f["dow"] / 7)
    return f

df = add_calendar(df)

# Leakage check: a "usual" value averaged over the whole period is constant across weeks for a given weekday + slot.
LEAKY_USUAL = {}
for col in ["usual_volume", "usual_dwell_minutes"]:
    if col in df:
        per_slot_variation = df.groupby(["dow", "sod"])[col].nunique().median()
        LEAKY_USUAL[col] = per_slot_variation <= 1
        print(f"{col}: median distinct values per weekday+slot = {per_slot_variation:.0f} → "
              + ("CONSTANT across weeks → averaged over the whole period (leaks the future): reference only, not a feature"
                 if LEAKY_USUAL[col] else "varies week to week (likely trailing): still not used as a feature, kept as a baseline"))
mlflow.set_tags({f"leaky_{k}": str(v) for k, v in LEAKY_USUAL.items()})
mlflow.log_params({"slot_minutes": SLOT_MIN, "missing_slots_filled": len(missing), "rows": len(raw)})

# COMMAND ----------

# MAGIC %md
# MAGIC ## 2. Features per horizon
# MAGIC Existing features used as-is: calendar position, events (holiday / large / small / other counts), weather (week-ahead only).
# MAGIC History features are built from `volume` / `dwell_minutes`, **all at least H days old**:
# MAGIC * `vol_lag_H`, `vol_lag_H+7`: same slot, H and H+7 days ago
# MAGIC * `vol_trail_med_4w`, `vol_trail_mean_4w`: same slot over the 4 weeks ending H days ago (the model's own "usual")
# MAGIC * `vol_24h_sum_H`: total volume in the 24h ending H days ago (recent level)
# MAGIC * `dwell_lag_H`, `dwell_trail_med_4w`: same for dwell

# COMMAND ----------

BASE = ["sod", "hour", "dow", "is_weekend", "sod_sin", "sod_cos", "dow_sin", "dow_cos",
        "is_holiday", "n_large", "n_small", "n_other", "n_events"]

def history_features(f, H):
    n, wk = H * SPD, 7 * SPD
    out = pd.DataFrame(index=f.index)
    out["vol_lag_H"] = f["volume"].shift(n)
    out["vol_lag_H7"] = f["volume"].shift(n + wk)
    past = pd.concat([f["volume"].shift(n + k * wk) for k in range(4)], axis=1)
    out["vol_trail_med_4w"] = past.median(axis=1)
    out["vol_trail_mean_4w"] = past.mean(axis=1)
    out["vol_24h_sum_H"] = f["volume"].shift(n).rolling(SPD, min_periods=SPD // 2).sum()
    if "dwell_minutes" in f:
        out["dwell_lag_H"] = f["dwell_minutes"].shift(n)
        out["dwell_trail_med_4w"] = pd.concat([f["dwell_minutes"].shift(n + k * wk) for k in range(4)], axis=1).median(axis=1)
    return out

def feature_list(name, hist_cols):
    return BASE + list(hist_cols) + (WEATHER_COLS if name == "week_ahead" else [])

def fit_quantile(X, y):
    m = xgb.XGBRegressor(objective="reg:quantileerror", quantile_alpha=np.array(QUANTILES),
                         n_estimators=700, learning_rate=0.04, max_depth=6, min_child_weight=5,
                         subsample=0.8, colsample_bytree=0.8, reg_lambda=1.0, tree_method="hist", random_state=42)
    m.fit(X, y)
    return m

def predict_q(m, X):
    p = np.clip(np.sort(np.asarray(m.predict(X)).reshape(len(X), -1), axis=1), 0, None)   # sorted: no crossing quantiles
    return p[:, 0], p[:, 1], p[:, 2]

# COMMAND ----------

# MAGIC %md
# MAGIC ## 3. Backtest: train Nov–Jun, test Jul–Aug

# COMMAND ----------

BUSY = df.loc[df["date"] <= TRAIN_END, "volume"].quantile(BUSY_Q)
print(f"Busy slot threshold (top {1 - BUSY_Q:.0%} of training slots): {BUSY:,.0f}")

def score(y, p10, p50, p90, ref=None):
    e = p50 - y
    ba, bp = y >= BUSY, p50 >= BUSY
    r = {"MAE": np.nanmean(np.abs(e)), "RMSE": np.sqrt(np.nanmean(e ** 2)),
         "MAE_busy_slots": np.nanmean(np.abs(e[ba])) if ba.any() else np.nan,
         "busy_slots_caught": (ba & bp).sum() / max(1, ba.sum()),
         "busy_precision": (ba & bp).sum() / max(1, bp.sum()),
         "p10_p90_coverage": np.mean((y >= p10) & (y <= p90)),
         "avg_band_width": np.mean(p90 - p10)}
    if ref is not None:
        r["MAE_baseline"] = np.nanmean(np.abs(ref - y))
        r["improvement_vs_baseline"] = 1 - r["MAE"] / r["MAE_baseline"]
    return r

bt, rows, models_bt = {}, [], {}
for name, H in HORIZONS.items():
    hist = history_features(df, H)
    feats = feature_list(name, hist.columns)
    data = pd.concat([df, hist], axis=1).dropna(subset=["vol_lag_H", "vol_trail_med_4w"])
    tr, te = data[data["date"] <= TRAIN_END], data[data["date"] >= TEST_START].copy()
    m = fit_quantile(tr[feats], tr["volume"])
    te["p10"], te["p50"], te["p90"] = predict_q(m, te[feats])
    bt[name], models_bt[name] = te, (m, feats)
    y = te["volume"].values
    rows.append({"model": f"XGBoost {name}", **score(y, te["p10"].values, te["p50"].values, te["p90"].values, te["vol_trail_med_4w"].values)})
    for bname, ref in [(f"baseline: same slot {H}d ago", te["vol_lag_H"]), ("baseline: 4-week same-slot median", te["vol_trail_med_4w"])]:
        rows.append({"model": f"{bname} ({name})", **score(y, ref.values, ref.values, ref.values)})
    if "usual_volume" in te:
        tag = "leaky, reference only" if LEAKY_USUAL.get("usual_volume") else "as provided"
        u = te["usual_volume"].values
        rows.append({"model": f"usual_volume ({tag})", **score(y, u, u, u)})
    print(f"{name}: train {len(tr):,} slots, test {len(te):,} slots, {len(feats)} features")

metrics = pd.DataFrame(rows).drop_duplicates("model").set_index("model")
display(metrics.round(3).reset_index())
mlflow.log_metric("busy_threshold", float(BUSY))
log_metric_table(metrics, "backtest")
log_df(metrics.reset_index(), "backtest/metrics.csv")
for name, te in bt.items():
    log_df(te[["slot_start", "volume", "p10", "p50", "p90", "vol_lag_H", "vol_trail_med_4w"]], f"backtest/predictions_{name}.csv")

# COMMAND ----------

# Daily view: what dispatch plans around (daily peak size + timing, daily total)
daily_rows = []
for name, te in bt.items():
    g = te.groupby("date")
    d = pd.DataFrame({"actual_total": g["volume"].sum(), "forecast_total": g["p50"].sum(),
                      "actual_peak": g["volume"].max(), "forecast_peak": g["p50"].max(),
                      "actual_peak_time": te.loc[g["volume"].idxmax(), "slot_start"].dt.hour.values + te.loc[g["volume"].idxmax(), "slot_start"].dt.minute.values / 60,
                      "forecast_peak_time": te.loc[g["p50"].idxmax(), "slot_start"].dt.hour.values + te.loc[g["p50"].idxmax(), "slot_start"].dt.minute.values / 60})
    daily_rows.append({"model": name,
                       "daily_total_MAPE": np.mean(np.abs(d["forecast_total"] - d["actual_total"]) / d["actual_total"]),
                       "daily_peak_MAE": np.mean(np.abs(d["forecast_peak"] - d["actual_peak"])),
                       "peak_time_error_h (median)": np.median(np.abs(d["forecast_peak_time"] - d["actual_peak_time"]))})
daily_metrics = pd.DataFrame(daily_rows).set_index("model")
display(daily_metrics.round(3).reset_index())
log_metric_table(daily_metrics, "backtest_daily")
log_df(daily_metrics.reset_index(), "backtest/daily_metrics.csv")

# COMMAND ----------

# Metric plots: XGBoost vs baselines (error, lower = better) and hit rates (higher = better)
mt = metrics.copy()
mt.index = [i.replace("baseline: ", "").replace(" (week_ahead)", " [wk]").replace(" (month_ahead)", " [mo]") for i in mt.index]
colors = ["#4C78A8" if i.startswith("XGBoost") else "#BAB0AC" for i in mt.index]
fig, axes = plt.subplots(1, 3, figsize=(24, 6))
for ax, col, title in [(axes[0], "MAE", "MAE, all slots"), (axes[1], "MAE_busy_slots", "MAE, busy slots only")]:
    v = mt[col].sort_values()
    ax.barh(v.index, v.values, color=[colors[list(mt.index).index(i)] for i in v.index])
    for i, x in enumerate(v.values):
        ax.text(x, i, f" {x:,.0f}", va="center", fontsize=8)
    ax.set_title(f"{title} (lower is better; blue = XGBoost)")
xg = mt[mt.index.str.startswith("XGBoost")][["busy_slots_caught", "busy_precision", "p10_p90_coverage"]]
xg.T.plot.bar(ax=axes[2], rot=0, color=["#4C78A8", "#F58518"][:len(xg)])
axes[2].axhline(0.8, color="grey", ls="--", lw=1, label="80% (coverage target)")
axes[2].yaxis.set_major_formatter(mtick.PercentFormatter(1.0))
axes[2].set_ylim(0, 1.05)
axes[2].set_title("XGBoost: busy slots caught, precision, p10–p90 coverage")
axes[2].legend()
show_and_log(fig, "metrics/backtest_metrics.png")

fig, ax = plt.subplots(figsize=(10, 4.5))
imp = mt[mt.index.str.startswith("XGBoost")]["improvement_vs_baseline"]
ax.bar(imp.index, imp.values, color=np.where(imp.values >= 0, "#54A24B", "#E45756"))
ax.axhline(0, color="black", lw=0.8)
ax.yaxis.set_major_formatter(mtick.PercentFormatter(1.0))
ax.set_title("Improvement over the 4-week same-slot median (positive = model beats the usual pattern)")
show_and_log(fig, "metrics/improvement_vs_baseline.png")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 4. Backtest charts + feature importance

# COMMAND ----------

fig, axes = plt.subplots(len(bt), 1, figsize=(18, 5 * len(bt)), squeeze=False)
for ax, (name, te) in zip(axes[:, 0], bt.items()):
    start = te["date"].min() + pd.Timedelta(days=(7 - te["date"].min().dayofweek) % 7)      # first Monday in test
    w = te[(te["date"] >= start) & (te["date"] < start + pd.Timedelta(days=7))]
    ax.fill_between(w["slot_start"], w["p10"], w["p90"], alpha=0.25, label="p10–p90")
    ax.plot(w["slot_start"], w["p50"], lw=1.5, label="forecast p50")
    ax.plot(w["slot_start"], w["volume"], color="black", lw=1.2, label="actual")
    ax.axhline(BUSY, color="red", ls=":", label="busy threshold")
    ax.set_title(f"{name}: week of {start:%Y-%m-%d} (test period, never seen in training)")
    ax.legend(loc="upper left")
show_and_log(fig, "backtest/plots/first_test_week.png")

fig, ax = plt.subplots(figsize=(18, 5))
for name, te in bt.items():
    d = te.groupby("date")[["volume", "p50"]].sum()
    ax.plot(d.index, d["p50"], lw=1.5, label=f"forecast ({name})")
ax.plot(d.index, d["volume"], color="black", lw=2, label="actual")
ax.set_title("Daily crowd volume, Jul–Aug: actual vs forecast")
ax.legend()
show_and_log(fig, "backtest/plots/daily_totals.png")

# COMMAND ----------

fig, axes = plt.subplots(1, len(models_bt), figsize=(9 * len(models_bt), 6), squeeze=False)
importance = {}
for ax, (name, (m, feats)) in zip(axes[0], models_bt.items()):
    gain = pd.Series(m.get_booster().get_score(importance_type="gain")).reindex(feats).fillna(0)
    gain = gain / gain.sum()
    importance[name] = gain
    gain.sort_values().plot.barh(ax=ax, color="#4C78A8")
    ax.xaxis.set_major_formatter(mtick.PercentFormatter(1.0))
    ax.set_title(f"{name}: share of total gain")
show_and_log(fig, "feature_importance/importance.png")
log_df(pd.DataFrame(importance).rename_axis("feature").reset_index(), "feature_importance/importance.csv")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4b. Backtest plots: forecast vs real data (Jul–Aug, never seen in training)
# MAGIC Interactive: drag the range slider to zoom into any day. Black = actual, blue = forecast p50, band = p10–p90.

# COMMAND ----------

fig = make_subplots(rows=len(bt), cols=1, shared_xaxes=True, vertical_spacing=0.06,
                    subplot_titles=[f"{n}: actual vs forecast, Jul–Aug backtest" for n in bt])
for i, (name, te) in enumerate(bt.items(), start=1):
    fig.add_trace(go.Scatter(x=te["slot_start"], y=te["p90"], line=dict(width=0), showlegend=False, hoverinfo="skip"), row=i, col=1)
    fig.add_trace(go.Scatter(x=te["slot_start"], y=te["p10"], fill="tonexty", fillcolor="rgba(76,120,168,0.25)",
                             line=dict(width=0), name="p10–p90", showlegend=(i == 1)), row=i, col=1)
    fig.add_trace(go.Scatter(x=te["slot_start"], y=te["p50"], line=dict(color="#4C78A8", width=1.2),
                             name="forecast p50", showlegend=(i == 1)), row=i, col=1)
    fig.add_trace(go.Scatter(x=te["slot_start"], y=te["volume"], line=dict(color="black", width=1),
                             name="actual", showlegend=(i == 1)), row=i, col=1)
    fig.add_hline(y=BUSY, line_dash="dot", line_color="red", row=i, col=1)
fig.update_layout(height=430 * len(bt), hovermode="x unified", title="Backtest: forecast vs real data")
fig.update_xaxes(rangeslider_visible=True, rangeslider_thickness=0.05, row=len(bt), col=1)
log_fig(fig, "backtest/plots/jul_aug_interactive.html")
fig.show()

# COMMAND ----------

# Zoom: the busiest test day, a typical weekday and a typical weekend day, for both models
dsum = bt["week_ahead"].groupby("date")["volume"].sum()
wd, we = dsum[dsum.index.dayofweek < 5], dsum[dsum.index.dayofweek >= 5]
days = {"busiest day": dsum.idxmax(),
        "typical weekday": (wd - wd.median()).abs().idxmin(),
        "typical weekend day": (we - we.median()).abs().idxmin()}
fig, axes = plt.subplots(len(bt), len(days), figsize=(21, 4.5 * len(bt)), squeeze=False, sharey=True)
for i, (name, te) in enumerate(bt.items()):
    for j, (label, d) in enumerate(days.items()):
        w, ax = te[te["date"] == d], axes[i][j]
        ax.fill_between(w["slot_start"], w["p10"], w["p90"], alpha=0.25, label="p10–p90")
        ax.plot(w["slot_start"], w["p50"], color="#4C78A8", lw=1.8, label="forecast p50")
        ax.plot(w["slot_start"], w["volume"], color="black", lw=1.5, label="actual")
        ax.axhline(BUSY, color="red", ls=":", lw=1)
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
        mae = np.mean(np.abs(w["p50"] - w["volume"]))
        ax.set_title(f"{name} · {label}\n{d:%a %Y-%m-%d} (MAE {mae:,.0f})")
axes[0][0].legend(loc="upper left")
show_and_log(fig, "backtest/plots/zoom_days.png")

# COMMAND ----------

# Diagnostics: predicted vs actual, error by hour of day, and whether the p10–p90 band holds ~80% of actuals
fig, axes = plt.subplots(1, 3, figsize=(21, 5.5))
for name, te in bt.items():
    axes[0].scatter(te["volume"], te["p50"], s=3, alpha=0.25, label=name)
    by_h = te.assign(ae=(te["p50"] - te["volume"]).abs(),
                     inside=((te["volume"] >= te["p10"]) & (te["volume"] <= te["p90"])).astype(float)).groupby("hour")
    axes[1].plot(by_h["ae"].mean(), marker="o", label=name)
    axes[2].plot(by_h["inside"].mean(), marker="o", label=name)
lim = [0, max(bt["week_ahead"]["volume"].max(), bt["week_ahead"]["p50"].max()) * 1.05]
axes[0].plot(lim, lim, color="grey", ls="--")
axes[0].set(xlabel="actual", ylabel="forecast p50", title="Forecast vs actual (each dot = one slot)")
axes[1].set(xlabel="hour of day", ylabel="mean absolute error", title="Where the error is: by hour")
axes[2].axhline(0.8, color="grey", ls="--", label="target 80%")
axes[2].yaxis.set_major_formatter(mtick.PercentFormatter(1.0))
axes[2].set(xlabel="hour of day", ylim=(0, 1.02), title="Share of actuals inside p10–p90, by hour")
for ax in axes:
    ax.legend()
show_and_log(fig, "backtest/plots/diagnostics.png")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 4c. Jul and Aug: forecast vs real data vs same time last month
# MAGIC Uses the backtest predictions above (no retraining). **Same time last month** = the real crowd on the same weekday + slot 4 weeks earlier, the simple rule a planner would use.

# COMMAND ----------

vol_by_slot = df.set_index("slot_start")["volume"]

def same_time_last_month(slots):
    v = vol_by_slot.reindex(slots - pd.Timedelta(days=LAST_MONTH_DAYS)).values
    alt = vol_by_slot.reindex(slots - pd.Timedelta(days=LAST_MONTH_DAYS + 7)).values
    return np.where(np.isnan(v), alt, v)

mp, mrows = [], []
for name, te in bt.items():
    t = te.assign(model=name, month=te["slot_start"].dt.to_period("M").astype(str),
                  last_month=same_time_last_month(te["slot_start"]))
    mp.append(t[["slot_start", "date", "month", "model", "volume", "p10", "p50", "p90", "last_month"]])
    for mth, g in t.groupby("month"):
        y = g["volume"].values
        mrows.append({"month": mth, "model": name,
                      **score(y, g["p10"].values, g["p50"].values, g["p90"].values, g["vol_trail_med_4w"].values),
                      "MAE_same_time_last_month": np.nanmean(np.abs(g["last_month"].values - y))})
monthly_pred = pd.concat(mp, ignore_index=True)
monthly_metrics = pd.DataFrame(mrows)
display(monthly_metrics[["month", "model", "MAE", "MAE_baseline", "MAE_same_time_last_month", "p10_p90_coverage"]].round(3))
log_df(monthly_metrics, "monthly/monthly_metrics.csv")

for mth in sorted(monthly_pred["month"].unique()):
    g = monthly_pred[monthly_pred["month"] == mth]
    wk, mo = g[g["model"] == "week_ahead"], g[g["model"] == "month_ahead"]
    actual = (wk if len(wk) else mo).drop_duplicates("slot_start")
    fig, axes = plt.subplots(2, 1, figsize=(22, 9), gridspec_kw={"height_ratios": [1.6, 1]})
    ax = axes[0]
    ax.plot(actual["slot_start"], actual["last_month"], color="grey", lw=0.8, ls=":", label="same time last month (actual)")
    if len(wk):
        ax.fill_between(wk["slot_start"], wk["p10"], wk["p90"], color="#4C78A8", alpha=0.18, label="week-ahead p10–p90")
        ax.plot(wk["slot_start"], wk["p50"], color="#4C78A8", lw=1, label="week-ahead p50")
    if len(mo):
        ax.plot(mo["slot_start"], mo["p50"], color="#F58518", lw=1, label="month-ahead p50")
    ax.plot(actual["slot_start"], actual["volume"], color="black", lw=0.9, label="actual (real data)")
    ax.axhline(BUSY, color="red", ls=":", lw=1)
    ax.set_title(f"{mth}: crowd per {SLOT_MIN} min, forecast vs real data vs same time last month")
    ax.legend(loc="upper left", fontsize=8, ncol=5)
    d = g.groupby(["date", "model"])[["volume", "p50", "last_month"]].sum().unstack("model")
    first = d.columns.get_level_values("model")[0]
    ax = axes[1]
    ax.plot(d.index, d[("volume", first)], color="black", lw=2, marker="o", ms=3, label="actual")
    ax.plot(d.index, d[("last_month", first)], color="grey", ls=":", marker=".", label="same time last month")
    for name, c in [("week_ahead", "#4C78A8"), ("month_ahead", "#F58518")]:
        if ("p50", name) in d:
            ax.plot(d.index, d[("p50", name)], color=c, marker=".", label=f"{name} p50")
    ax.set_title(f"{mth}: daily totals")
    ax.legend(fontsize=8)
    show_and_log(fig, f"monthly/plots/{mth}.png")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5. Final models on all data → next 30 days
# MAGIC Both models are retrained on Nov–Aug. Days 1–7 come from **week_ahead**, days 8–30 from **month_ahead** (its history features are ≥ 35 days old, so all of them exist for every forecast day).
# MAGIC Future events: `FUTURE_HOLIDAYS` + `FUTURE_EVENTS` (from the events agent). Future weather: `FUTURE_WEATHER` if provided, else the recent average for that slot.

# COMMAND ----------

last = df["slot_start"].max()
fut = pd.DataFrame({"slot_start": pd.date_range(last + pd.Timedelta(minutes=SLOT_MIN), periods=FORECAST_DAYS * SPD, freq=f"{SLOT_MIN}min")})
fut["volume"] = np.nan
fut["dwell_minutes"] = np.nan
fut = add_calendar(fut)

# Future events -> the same id-free category counts the model was trained on
def future_events(t):
    labels = []
    d = t.strftime("%Y-%m-%d")
    if d in FUTURE_HOLIDAYS:
        labels.append("holiday")
    for e in FUTURE_EVENTS:
        if e["date"] == d and e.get("start", "00:00") <= t.strftime("%H:%M") <= e.get("end", "23:59"):
            labels.append(e["category"])
    return labels
fut["event_list"] = fut["slot_start"].map(future_events)
fut = add_event_counts(fut)

# Future weather
if FUTURE_WEATHER is not None:
    fw = FUTURE_WEATHER.copy()
    fw["slot_start"] = pd.to_datetime(fw["slot_start"]).dt.tz_localize(None)
    fut = fut.merge(fw[["slot_start"] + WEATHER_COLS], on="slot_start", how="left")
else:
    recent = df[df["date"] > df["date"].max() - pd.Timedelta(days=28)].groupby(["dow", "sod"])[WEATHER_COLS].mean().reset_index()
    fut = fut.merge(recent, on=["dow", "sod"], how="left")

allf = pd.concat([df, fut], ignore_index=True).sort_values("slot_start").reset_index(drop=True)
is_future = allf["slot_start"] > last
day_ahead = ((allf["date"] - last.normalize()).dt.days).where(is_future)

final_models, parts = {}, []
for name, H in HORIZONS.items():
    hist = history_features(allf, H)
    feats = feature_list(name, hist.columns)
    data = pd.concat([allf, hist], axis=1)
    train_all = data[~is_future].dropna(subset=["vol_lag_H", "vol_trail_med_4w"])
    m = fit_quantile(train_all[feats], train_all["volume"])
    final_models[name] = (m, feats)
    lo, hi = (1, 7) if name == "week_ahead" else (8, FORECAST_DAYS)
    sel = data[is_future & day_ahead.between(lo, hi)].copy()
    sel["p10"], sel["p50"], sel["p90"] = predict_q(m, sel[feats])
    sel["model"], sel["usual"], sel["day_ahead"] = name, sel["vol_trail_med_4w"], day_ahead[sel.index]
    parts.append(sel)

fc = pd.concat(parts).sort_values("slot_start").reset_index(drop=True)
fc["vs_usual_pct"] = fc["p50"] / fc["usual"].replace(0, np.nan) - 1
fc["level"] = np.select([(fc["p50"] >= BUSY) | (fc["vs_usual_pct"] >= 0.25),
                         (fc["p90"] >= BUSY) | (fc["vs_usual_pct"] >= 0.10)], ["high", "watch"], "normal")
print(f"Forecast {fc['slot_start'].min()} → {fc['slot_start'].max()}: {len(fc):,} slots, "
      f"{(fc['level'] == 'high').sum()} high / {(fc['level'] == 'watch').sum()} watch")

fig, ax = plt.subplots(figsize=(18, 5))
tail = df[df["slot_start"] > last - pd.Timedelta(days=7)]
ax.plot(tail["slot_start"], tail["volume"], color="black", lw=1, label="last 7 days (actual)")
for name, g in fc.groupby("model"):
    ax.fill_between(g["slot_start"], g["p10"], g["p90"], alpha=0.2)
    ax.plot(g["slot_start"], g["p50"], lw=1, label=f"forecast p50 ({name})")
ax.axhline(BUSY, color="red", ls=":", label="busy threshold")
ax.set_title(f"Waterfront crowd forecast: next {FORECAST_DAYS} days")
ax.legend(loc="upper left")
show_and_log(fig, "forecast/plots/overview.png")
log_df(fc.drop(columns=[c for c in fc.columns if c not in ["slot_start", "date", "day_ahead", "model", "p10", "p50", "p90",
                                                             "usual", "vs_usual_pct", "level", "is_holiday", "n_large", "n_small"]]),
       "forecast/forecast_slots.csv")

# COMMAND ----------

# MAGIC %md
# MAGIC ### 5b. Future forecast plots
# MAGIC * **Next 7 days** (week_ahead model): the last 14 days of real data, then the forecast
# MAGIC * **Next 30 days** (week_ahead for days 1–7, month_ahead for days 8–30)

# COMMAND ----------

LEVEL_COLORS = {"high": "#E45756", "watch": "#F58518", "normal": "#54A24B"}

def forecast_figure(f, history_days, title):
    hist = df[df["slot_start"] > last - pd.Timedelta(days=history_days)]
    fig = go.Figure()
    fig.add_trace(go.Scatter(x=hist["slot_start"], y=hist["volume"], line=dict(color="black", width=1), name="actual (real data)"))
    fig.add_trace(go.Scatter(x=f["slot_start"], y=f["p90"], line=dict(width=0), showlegend=False, hoverinfo="skip"))
    fig.add_trace(go.Scatter(x=f["slot_start"], y=f["p10"], fill="tonexty", fillcolor="rgba(76,120,168,0.25)",
                             line=dict(width=0), name="p10–p90"))
    fig.add_trace(go.Scatter(x=f["slot_start"], y=f["p50"], line=dict(color="#4C78A8", width=1.4), name="forecast p50",
                             customdata=np.stack([f["p10"], f["p90"], f["vs_usual_pct"].fillna(0) * 100, f["level"], f["model"]], axis=1),
                             hovertemplate="%{x}<br>p50 %{y:,.0f} (p10 %{customdata[0]:,.0f} – p90 %{customdata[1]:,.0f})"
                                           "<br>%{customdata[2]:+.0f}% vs usual · %{customdata[3]} · %{customdata[4]}<extra></extra>"))
    fig.add_trace(go.Scatter(x=f["slot_start"], y=f["usual"], line=dict(color="grey", width=1, dash="dot"), name="usual (4-week same-slot median)"))
    for lvl in ["high", "watch"]:
        s = f[f["level"] == lvl]
        fig.add_trace(go.Scatter(x=s["slot_start"], y=s["p50"], mode="markers", marker=dict(color=LEVEL_COLORS[lvl], size=5), name=f"{lvl} slots"))
    fig.add_hline(y=BUSY, line_dash="dot", line_color="red")
    fig.add_shape(type="line", x0=last, x1=last, y0=0, y1=1, yref="paper", line=dict(color="grey", dash="dash"))
    fig.add_annotation(x=last, y=1, yref="paper", text="forecast starts", showarrow=False, xanchor="left")
    fig.update_layout(title=title, height=480, hovermode="x unified", yaxis_title=f"crowd size (connections / {SLOT_MIN} min)")
    fig.update_xaxes(rangeslider_visible=True, rangeslider_thickness=0.05)
    return fig

f7 = fc[fc["day_ahead"] <= 7]
fig7 = forecast_figure(f7, 14, "Waterfront: next 7 days (after 14 days of real data)")
log_fig(fig7, "forecast/plots/next_7_days.html")
fig7.show()

# COMMAND ----------

# 7-day summary: daily peak with its range, and a day × hour heatmap of the forecast
def daily_summary(f):
    g = f.groupby("date")
    d = pd.DataFrame({"peak_p50": g["p50"].max(), "peak_p90": g["p90"].max(), "total_p50": g["p50"].sum(),
                      "high_slots": g["level"].apply(lambda s: int((s == "high").sum())),
                      "watch_slots": g["level"].apply(lambda s: int((s == "watch").sum())),
                      "holiday": g["is_holiday"].max(), "large_events": g["n_large"].max()})
    d["peak_time"] = f.loc[g["p50"].idxmax(), "slot_start"].dt.strftime("%H:%M").values
    d["level"] = np.select([d["high_slots"] > 0, d["watch_slots"] > 0], ["high", "watch"], "normal")
    return d

def summary_plots(f, title, path):
    d = daily_summary(f)
    fig, axes = plt.subplots(1, 2, figsize=(22, 5.5), gridspec_kw={"width_ratios": [1, 1.4]})
    x = np.arange(len(d))
    axes[0].bar(x, d["peak_p50"], color=[LEVEL_COLORS[l] for l in d["level"]], alpha=0.85, label="peak p50")
    axes[0].errorbar(x, d["peak_p50"], yerr=[np.zeros(len(d)), d["peak_p90"] - d["peak_p50"]], fmt="none", ecolor="black", capsize=3, label="up to p90")
    axes[0].axhline(BUSY, color="red", ls=":", label="busy threshold")
    for i, (dte, r) in enumerate(d.iterrows()):
        tag = ("H " if r["holiday"] else "") + ("E" if r["large_events"] else "")
        axes[0].text(i, r["peak_p90"], f"{r['peak_time']}\n{tag}", ha="center", va="bottom", fontsize=7)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels([t.strftime("%a\n%m-%d") for t in d.index], fontsize=8)
    axes[0].set_title(f"{title}: daily peak (colour = level; label = peak time, H holiday, E large event)")
    axes[0].legend(loc="lower right", fontsize=8)
    hm = f.assign(day=f["date"].dt.strftime("%a %m-%d")).pivot_table(index="day", columns="hour", values="p50", aggfunc="max", sort=False)
    im = axes[1].imshow(hm.values, aspect="auto", cmap="magma_r")
    axes[1].set_yticks(range(len(hm)))
    axes[1].set_yticklabels(hm.index, fontsize=8)
    axes[1].set_xticks(range(len(hm.columns)))
    axes[1].set_xticklabels(hm.columns)
    axes[1].set_xlabel("hour")
    axes[1].set_title(f"{title}: forecast crowd (p50) by day × hour")
    plt.colorbar(im, ax=axes[1], label="crowd size")
    show_and_log(fig, path)
    log_df(d.reset_index(), path.replace("plots/", "").replace(".png", ".csv"))
    return d

d7 = summary_plots(f7, "Next 7 days", "forecast/plots/next_7_days_summary.png")
display(d7.reset_index())

# COMMAND ----------

# Next 30 days: week_ahead for days 1–7, month_ahead for days 8–30 (dashed line = model hand-off)
f30 = fc[fc["day_ahead"] <= 30]
fig = forecast_figure(f30, 30, "Waterfront: next 30 days (after 30 days of real data)")
handoff = f30.loc[f30["model"] == "month_ahead", "slot_start"].min()
if pd.notna(handoff):
    fig.add_shape(type="line", x0=handoff, x1=handoff, y0=0, y1=1, yref="paper", line=dict(color="purple", dash="dot"))
    fig.add_annotation(x=handoff, y=0.95, yref="paper", text="month-ahead model", showarrow=False, xanchor="left", font=dict(color="purple"))
log_fig(fig, "forecast/plots/next_30_days.html")
fig.show()

d30 = summary_plots(f30, "Next 30 days", "forecast/plots/next_30_days_summary.png")
display(d30.reset_index())

# COMMAND ----------

# New forecast overlaid on the same time last month (same weekday + slot 4 weeks earlier, real data)
fc["last_month"] = same_time_last_month(fc["slot_start"])
fc["vs_last_month_pct"] = fc["p50"] / fc["last_month"].replace(0, np.nan) - 1
fig = go.Figure()
fig.add_trace(go.Scatter(x=fc["slot_start"], y=fc["last_month"], line=dict(color="grey", width=1, dash="dot"),
                         name=f"same time last month (actual, {LAST_MONTH_DAYS} days earlier)"))
fig.add_trace(go.Scatter(x=fc["slot_start"], y=fc["p90"], line=dict(width=0), showlegend=False, hoverinfo="skip"))
fig.add_trace(go.Scatter(x=fc["slot_start"], y=fc["p10"], fill="tonexty", fillcolor="rgba(76,120,168,0.25)", line=dict(width=0), name="p10–p90"))
fig.add_trace(go.Scatter(x=fc["slot_start"], y=fc["p50"], line=dict(color="#4C78A8", width=1.4), name="new forecast p50"))
fig.update_layout(title=f"Next {FORECAST_DAYS} days vs the same time last month", height=480, hovermode="x unified",
                  yaxis_title=f"crowd size (connections / {SLOT_MIN} min)")
fig.update_xaxes(rangeslider_visible=True, rangeslider_thickness=0.05)
log_fig(fig, "forecast/plots/forecast_vs_last_month.html")
fig.show()

dd = fc.groupby("date")[["p50", "p10", "p90", "last_month"]].sum()
fig, ax = plt.subplots(figsize=(20, 5))
ax.fill_between(dd.index, dd["p10"], dd["p90"], color="#4C78A8", alpha=0.2, label="forecast p10–p90 (daily)")
ax.plot(dd.index, dd["p50"], color="#4C78A8", marker="o", label="new forecast p50 (daily total)")
ax.plot(dd.index, dd["last_month"], color="grey", ls=":", marker=".", label="same time last month (actual)")
for t, r in dd.iterrows():
    if r["last_month"] > 0:
        ax.text(t, r["p50"], f"{r['p50'] / r['last_month'] - 1:+.0%}", ha="center", va="bottom", fontsize=7)
ax.set_title("Daily totals: new forecast vs the same days last month (label = % change)")
ax.legend()
show_and_log(fig, "forecast/plots/forecast_vs_last_month_daily.png")
log_df(dd.reset_index(), "forecast/forecast_vs_last_month_daily.csv")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 5c. Any-date predictor: 48 × 30-min volume and dwell for a chosen date
# MAGIC `predict_day(date, inputs)` uses the **best model that has the history it needs**:
# MAGIC
# MAGIC | Model | Used when | Inputs it uses | Confidence |
# MAGIC |---|---|---|---|
# MAGIC | **week_ahead** | real data exists up to 7 days before the date | your inputs + real volume/dwell from 7–28 days earlier | high |
# MAGIC | **month_ahead** | real data exists up to 35 days before the date | your inputs (no weather) + real volume/dwell from 35–56 days earlier | medium |
# MAGIC | **outlook** | anything else (e.g. 2027) | your inputs only: calendar, month, holidays/events, weather | low (it predicts the typical pattern, not the recent level) |
# MAGIC
# MAGIC **What you supply** (all optional except the date): 48 rows with `slot_start`, `rain`, `temp_c`, `precip_mm`, `rain_mm`, `event_ids`.
# MAGIC Missing weather → the typical weather for that month and time of day. BC statutory holidays are added automatically.
# MAGIC Both **volume** and **dwell** get their own models (the dwell models have the same features, target = `dwell_minutes`).

# COMMAND ----------

DWELL_TARGET = "dwell_minutes"
OUTLOOK_FEATS = BASE + WEATHER_COLS + ["month"]
ALL_HOLIDAYS = dict(FUTURE_HOLIDAYS)
ALL_HOLIDAYS.update({  # BC statutory holidays, Nov 2025 – Aug 2027
    "2025-11-11": "Remembrance Day", "2025-12-25": "Christmas Day", "2026-01-01": "New Year's Day",
    "2026-02-16": "Family Day", "2026-04-03": "Good Friday", "2026-05-18": "Victoria Day", "2026-07-01": "Canada Day",
    "2026-08-03": "BC Day", "2026-09-07": "Labour Day", "2026-09-30": "National Day for Truth and Reconciliation",
    "2026-10-12": "Thanksgiving", "2026-11-11": "Remembrance Day", "2026-12-25": "Christmas Day", "2027-01-01": "New Year's Day",
    "2027-02-15": "Family Day", "2027-03-26": "Good Friday", "2027-05-24": "Victoria Day", "2027-07-01": "Canada Day",
    "2027-08-02": "BC Day"})
df["month"] = df["slot_start"].dt.month

def score_basic(y, p10, p50, p90, ref):
    e = p50 - y
    r = {"MAE": np.nanmean(np.abs(e)), "RMSE": np.sqrt(np.nanmean(e ** 2)),
         "p10_p90_coverage": np.nanmean((y >= p10) & (y <= p90)), "avg_band_width": np.nanmean(p90 - p10),
         "MAE_baseline": np.nanmean(np.abs(ref - y))}
    r["improvement_vs_baseline"] = 1 - r["MAE"] / r["MAE_baseline"]
    return r

extra_rows, dwell_models, outlook_models = [], {}, {}

# Dwell models (week / month): same history + calendar + event (+ weather) features, target = dwell_minutes
for name, H in HORIZONS.items():
    hist = history_features(df, H)
    feats = feature_list(name, hist.columns)
    data = pd.concat([df, hist], axis=1).dropna(subset=["vol_lag_H", "vol_trail_med_4w", DWELL_TARGET])
    tr, te = data[data["date"] <= TRAIN_END], data[data["date"] >= TEST_START]
    p10, p50, p90 = predict_q(fit_quantile(tr[feats], tr[DWELL_TARGET]), te[feats])
    extra_rows.append({"model": f"dwell {name}", **score_basic(te[DWELL_TARGET].values, p10, p50, p90, te["dwell_trail_med_4w"].values)})
    dwell_models[name] = (fit_quantile(data[feats], data[DWELL_TARGET]), feats)          # final: all data

# Outlook models (no history): calendar + month + events + weather, for volume and dwell
for target in ["volume", DWELL_TARGET]:
    d = df.dropna(subset=[target])
    tr, te = d[d["date"] <= TRAIN_END], d[d["date"] >= TEST_START]
    p10, p50, p90 = predict_q(fit_quantile(tr[OUTLOOK_FEATS], tr[target]), te[OUTLOOK_FEATS])
    profile = tr.groupby(["dow", "sod"])[target].median()                                  # baseline: typical weekday/slot
    ref = profile.reindex(pd.MultiIndex.from_arrays([te["dow"], te["sod"]])).values
    extra_rows.append({"model": f"outlook {target}", **score_basic(te[target].values, p10, p50, p90, ref)})
    outlook_models[target] = (fit_quantile(d[OUTLOOK_FEATS], d[target]), OUTLOOK_FEATS)  # final: all data

extra_metrics = pd.DataFrame(extra_rows).set_index("model")
display(extra_metrics.round(3).reset_index())
print("Note: in this backtest Jul–Aug are months the outlook model never saw, so its 'month' feature can't help there. "
      "That's the hardest case; for months it has seen (Nov–Aug) it knows the seasonal level.")
log_metric_table(extra_metrics, "backtest_extra")
log_df(extra_metrics.reset_index(), "backtest/metrics_dwell_and_outlook.csv")

# COMMAND ----------

TRAINED_MONTHS = set(df["month"].unique())
FIRST_DATE, LAST_DATE = df["date"].min(), df["date"].max()
WEATHER_TYPICAL = df.groupby(["month", "sod"])[WEATHER_COLS].mean()
WEATHER_BY_SOD = df.groupby("sod")[WEATHER_COLS].mean()

def _target_rows(date, inputs):
    D = pd.Timestamp(date).normalize()
    t = pd.DataFrame({"slot_start": pd.date_range(D, periods=SPD, freq=f"{SLOT_MIN}min")})
    if inputs is not None:
        inp = inputs.copy()
        inp["slot_start"] = pd.to_datetime(inp["slot_start"], utc=True).dt.tz_localize(None)
        t = t.merge(inp[["slot_start"] + [c for c in WEATHER_COLS + ["event_ids"] if c in inp]], on="slot_start", how="left")
    t = add_calendar(t)
    t["month"] = t["slot_start"].dt.month
    typical = WEATHER_TYPICAL.reindex(pd.MultiIndex.from_arrays([t["month"], t["sod"]])).reset_index(drop=True)
    fallback = WEATHER_BY_SOD.reindex(t["sod"]).reset_index(drop=True)
    for c in WEATHER_COLS:
        given = t[c].astype(float) if c in t else pd.Series(np.nan, index=t.index)
        t[c] = given.fillna(typical[c]).fillna(fallback[c]).values
    t["event_list"] = (t["event_ids"] if "event_ids" in t else pd.Series([[]] * len(t))).map(to_list)
    if D.strftime("%Y-%m-%d") in ALL_HOLIDAYS:
        t["event_list"] = t["event_list"].map(lambda l: l if any(categorize(e) == "holiday" for e in l) else l + ["holiday"])
    return D, add_event_counts(t)

def _history_for(D, H):
    # Contiguous grid: real data before D, NaN after it (so lags that fall after the data ends stay missing)
    past = df[df["date"] < D][["slot_start", "volume", DWELL_TARGET]]
    if past.empty:
        return None
    grid = pd.DataFrame({"slot_start": pd.date_range(past["slot_start"].min(), D + pd.Timedelta(days=1) - pd.Timedelta(minutes=SLOT_MIN),
                                                     freq=f"{SLOT_MIN}min")}).merge(past, on="slot_start", how="left")
    return history_features(grid, H).iloc[-SPD:].reset_index(drop=True)

def predict_day(date, inputs=None):
    # Returns 48 rows: volume + dwell p10/p50/p90 for each 30-min slot of `date`, and which model was used.
    D, t = _target_rows(date, inputs)
    used = "outlook"
    X = t
    for name, H in HORIZONS.items():                       # try week_ahead first, then month_ahead
        hf = _history_for(D, H)
        if hf is not None and hf["vol_lag_H"].notna().all():
            X, used = pd.concat([t.reset_index(drop=True), hf], axis=1), name
            break
    vm, vf = final_models[used] if used != "outlook" else outlook_models["volume"]
    dm, dfe = dwell_models[used] if used != "outlook" else outlook_models[DWELL_TARGET]
    v10, v50, v90 = predict_q(vm, X[vf])
    d10, d50, d90 = predict_q(dm, X[dfe])
    confidence = {"week_ahead": "high", "month_ahead": "medium"}.get(used, "low" if D.month not in TRAINED_MONTHS else "medium-low")
    out = pd.DataFrame({"slot_start": t["slot_start"], "clock": t["slot_start"].dt.strftime("%H:%M"),
                        "volume_p10": v10, "volume_p50": v50, "volume_p90": v90,
                        "dwell_p10": d10, "dwell_p50": d50, "dwell_p90": d90,
                        "model": used, "confidence": confidence, "is_holiday": t["is_holiday"].values,
                        "events": t["event_list"].values})
    if FIRST_DATE <= D <= LAST_DATE:                        # a date we have real data for: add actuals to compare
        act = df.set_index("slot_start").reindex(t["slot_start"])
        out["actual_volume"], out["actual_dwell"] = act["volume"].values, act[DWELL_TARGET].values
    return out

def plot_day(res, title):
    fig, axes = plt.subplots(1, 2, figsize=(22, 5))
    for ax, (k, unit) in zip(axes, [("volume", "connections / 30 min"), ("dwell", "minutes")]):
        ax.fill_between(res["slot_start"], res[f"{k}_p10"], res[f"{k}_p90"], alpha=0.25, label="p10–p90")
        ax.plot(res["slot_start"], res[f"{k}_p50"], lw=2, label="forecast p50")
        if f"actual_{k}" in res:
            ax.plot(res["slot_start"], res[f"actual_{k}"], color="black", lw=1.5, label="actual (real data)")
        ax.xaxis.set_major_formatter(mdates.DateFormatter("%H:%M"))
        ax.set_ylabel(unit)
        ax.set_title(f"{k.title()}: {title}")
        ax.legend(loc="upper left")
    if res["volume_p50"].size:
        axes[0].axhline(BUSY, color="red", ls=":", lw=1)
    return fig

# Input template: what the dispatch dashboard / events agent supplies for a date (weather + event_ids per slot)
INPUT_TEMPLATE = pd.DataFrame({"slot_start": pd.date_range("2027-03-15", periods=SPD, freq=f"{SLOT_MIN}min"),
                               "rain": False, "temp_c": 9.0, "precip_mm": 0.0, "rain_mm": 0.0,
                               "event_ids": [[] for _ in range(SPD)]})
display(INPUT_TEMPLATE.head())

# COMMAND ----------

# Examples: one date per model, each plotted and logged to MLflow under predict_day/
examples = {
    "past date with real data": min(pd.Timestamp("2026-07-23"), LAST_DATE),
    "5 days after the data ends": LAST_DATE + pd.Timedelta(days=5),
    "3 weeks after the data ends": LAST_DATE + pd.Timedelta(days=21),
    "a date in 2027 (with an input table)": pd.Timestamp("2027-03-15"),
}
for label, d in examples.items():
    res = predict_day(d, INPUT_TEMPLATE if d == pd.Timestamp("2027-03-15") else None)
    m, conf = res["model"].iloc[0], res["confidence"].iloc[0]
    print(f"{d:%a %Y-%m-%d} ({label}) → model {m}, confidence {conf}: daily volume p50 {res['volume_p50'].sum():,.0f}, "
          f"peak {res['volume_p50'].max():,.0f} at {res.loc[res['volume_p50'].idxmax(), 'clock']}")
    fig = plot_day(res, f"{d:%a %Y-%m-%d} · {label} · model {m} ({conf} confidence)")
    show_and_log(fig, f"predict_day/{d:%Y-%m-%d}.png")
    log_df(res.drop(columns=["events"]).assign(events=res["events"].map(json.dumps)), f"predict_day/{d:%Y-%m-%d}.csv")
display(res.round(1))

# COMMAND ----------

# MAGIC %md
# MAGIC ## 6. Export `forecast.json` + Delta tables

# COMMAND ----------

daily = (fc.groupby("date")
           .apply(lambda g: pd.Series({
               "total_p50": g["p50"].sum(), "peak_p50": g["p50"].max(), "peak_p90": g["p90"].max(),
               "peak_time": g.loc[g["p50"].idxmax(), "slot_start"].strftime("%H:%M"),
               "high_slots": int((g["level"] == "high").sum()), "watch_slots": int((g["level"] == "watch").sum()),
               "model": g["model"].iloc[0]}))
           .reset_index())
daily["level"] = np.select([daily["high_slots"] > 0, daily["watch_slots"] > 0], ["high", "watch"], "normal")

def clean(v):
    if isinstance(v, (np.floating, float)):
        return None if np.isnan(v) else round(float(v), 2)
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (pd.Timestamp, dt.datetime)):
        return v.isoformat()
    return v

payload = {
    "generated_at": dt.datetime.utcnow().isoformat() + "Z",
    "location": "Waterfront Station area",
    "unit": f"crowd size: device connections per {SLOT_MIN}-min slot",
    "slot_minutes": SLOT_MIN,
    "busy_threshold": clean(BUSY),
    "levels": {"high": "p50 ≥ busy threshold or ≥ 25% above usual",
               "watch": "p90 ≥ busy threshold or ≥ 10% above usual", "normal": "otherwise"},
    "backtest": {"train": f"≤ {TRAIN_END}", "test": f"≥ {TEST_START}",
                 "metrics": {k: {c: clean(v) for c, v in r.items()} for k, r in metrics.to_dict("index").items()},
                 "daily_metrics": {k: {c: clean(v) for c, v in r.items()} for k, r in daily_metrics.to_dict("index").items()}},
    "feature_importance": {k: {f: clean(v) for f, v in s.sort_values(ascending=False).items()} for k, s in importance.items()},
    "daily": [{k: clean(v) for k, v in r.items()} for r in daily.to_dict("records")],
    "slots": [{"slot_start": r["slot_start"].isoformat(), "model": r["model"],
               "p10": clean(r["p10"]), "p50": clean(r["p50"]), "p90": clean(r["p90"]),
               "usual": clean(r["usual"]), "vs_usual_pct": clean(r["vs_usual_pct"]), "level": r["level"],
               "is_holiday": int(r["is_holiday"]), "n_large": int(r["n_large"]), "n_small": int(r["n_small"]),
               "events": r["event_list"]} for _, r in fc.iterrows()],
}
path = os.path.join(OUTPUT_DIR, "forecast.json")
with open(path, "w") as fh:
    json.dump(payload, fh, indent=1, default=str)
print(f"wrote {path} ({os.path.getsize(path) / 1e6:.2f} MB): {len(payload['slots'])} slots, {len(payload['daily'])} days")

def to_delta(pdf, name):
    pdf = pdf.copy()
    for c in pdf.columns:
        if pdf[c].dtype == object:
            pdf[c] = pdf[c].map(lambda v: json.dumps(list(v)) if isinstance(v, (list, np.ndarray)) else v)
    spark.createDataFrame(pdf).write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(f"{GOLD_SCHEMA}.{name}")

to_delta(fc[["slot_start", "date", "model", "p10", "p50", "p90", "usual", "vs_usual_pct", "level",
             "is_holiday", "n_large", "n_small", "event_list"]], "wf_xgb_forecast")
to_delta(pd.concat([te.assign(model=name)[["slot_start", "model", "volume", "p10", "p50", "p90", "vol_trail_med_4w"]]
                    for name, te in bt.items()]), "wf_xgb_backtest")
to_delta(metrics.reset_index().rename(columns=lambda c: c.replace(" ", "_").replace("(", "").replace(")", "")), "wf_xgb_metrics")
print(f"Saved {GOLD_SCHEMA}.wf_xgb_forecast, wf_xgb_backtest, wf_xgb_metrics")
mlflow.log_artifact(path, artifact_path="forecast")
log_df(daily, "forecast/forecast_daily.csv")

# COMMAND ----------

# MAGIC %md
# MAGIC ## 7. Log models, close the MLflow run

# COMMAND ----------

def log_model(m, name, feats):
    try:
        mlflow.xgboost.log_model(m, name=name)                       # MLflow 3
    except TypeError:
        mlflow.xgboost.log_model(m, artifact_path=name)              # MLflow 2
    mlflow.log_text("\n".join(feats), f"models/{name}_features.txt")

for name, (m, feats) in final_models.items():
    log_model(m, f"{name}_final", feats)                            # trained on all data: used for the forecast
for name, (m, feats) in models_bt.items():
    log_model(m, f"{name}_backtest", feats)                         # trained Nov–Jun: produced the backtest metrics
for name, (m, feats) in dwell_models.items():
    log_model(m, f"dwell_{name}_final", feats)                      # dwell, trained on all data
for target, (m, feats) in outlook_models.items():
    log_model(m, f"outlook_{target}_final", feats)                  # any-date fallback, trained on all data
mlflow.log_params({f"xgb_{k}": v for k, v in final_models["week_ahead"][0].get_params().items()
                   if v is not None and k not in ("quantile_alpha", "missing")})

# API bundle: everything api/deploy_forecast_api.ipynb needs to package the model for serving
BUNDLE = os.path.join(ART_DIR, "api_bundle")
os.makedirs(BUNDLE, exist_ok=True)
bundle_models = {"volume_week_ahead": final_models["week_ahead"][0], "volume_month_ahead": final_models["month_ahead"][0],
                 "dwell_week_ahead": dwell_models["week_ahead"][0], "dwell_month_ahead": dwell_models["month_ahead"][0],
                 "volume_outlook": outlook_models["volume"][0], "dwell_outlook": outlook_models[DWELL_TARGET][0]}
for key, m in bundle_models.items():
    m.save_model(os.path.join(BUNDLE, f"{key}.json"))
max_h = max(HORIZONS.values())
df[df["slot_start"] > df["slot_start"].max() - pd.Timedelta(days=max_h + 35)][["slot_start", "volume", DWELL_TARGET]] \
    .to_csv(os.path.join(BUNDLE, "history.csv"), index=False)
WEATHER_TYPICAL.reset_index().to_csv(os.path.join(BUNDLE, "weather_typical.csv"), index=False)
WEATHER_BY_SOD.reset_index().to_csv(os.path.join(BUNDLE, "weather_by_sod.csv"), index=False)
df.groupby(["dow", "sod"])["volume"].median().rename("usual_volume").reset_index().to_csv(os.path.join(BUNDLE, "usual_profile.csv"), index=False)
with open(os.path.join(BUNDLE, "config.json"), "w") as fh:
    json.dump({"slot_minutes": SLOT_MIN, "horizons": HORIZONS, "busy_threshold": float(BUSY), "weather_cols": WEATHER_COLS,
               "categories": CATEGORIES, "category_map": CAT_MAP, "holidays": ALL_HOLIDAYS, "dwell_target": DWELL_TARGET,
               "trained_months": sorted(int(x) for x in TRAINED_MONTHS), "last_data_date": f"{LAST_DATE:%Y-%m-%d}",
               "levels": {"high": [0.25, "p50 >= busy"], "watch": [0.10, "p90 >= busy"]},
               "training_run_id": run.info.run_id, "feature_table": FEATURE_TABLE}, fh, indent=1)
mlflow.log_artifacts(BUNDLE, artifact_path="api_bundle")

run_id = run.info.run_id
mlflow.end_run()
print("=" * 80)
print(f"TRAINING RUN ID (paste into api/deploy_forecast_api.ipynb): {run_id}")
print("=" * 80)
try:
    folders = [a.path for a in mlflow.artifacts.list_artifacts(run_id=run_id)]
except Exception:
    folders = "(open the run to browse)"
print(f"MLflow run {run_id} closed. Artifact folders: {folders}")