-- Usual weekday + clock-time averages (the baseline the API returns as usual_*).
CREATE OR REFRESH MATERIALIZED VIEW gold_waterfront_baseline
COMMENT 'Hour-of-week baseline for MODEL-V1 usual_* fields. Keyed by day_of_week + clock.'
AS
SELECT
  day_of_week,
  clock,
  AVG(volume) AS usual_volume,
  AVG(dwell_minutes) AS usual_dwell_minutes,
  COUNT(*) AS n_slots
FROM silver_waterfront_bins_30m
GROUP BY day_of_week, clock;

-- Training grain without events (weather + usual only).
CREATE OR REFRESH MATERIALIZED VIEW gold_waterfront_bins_30m
COMMENT 'MODEL-V1 training grain: one Waterfront row per 30-min slot, with weather.'
AS
SELECT
  b.slot_start,
  b.day_of_week,
  b.clock,
  b.volume,
  b.dwell_minutes,
  b.mean_dwell_minutes,
  b.p90_dwell_minutes,
  bl.usual_volume,
  bl.usual_dwell_minutes,
  w.rain,
  w.temp_c,
  w.precip_mm,
  w.rain_mm
FROM silver_waterfront_bins_30m b
LEFT JOIN gold_waterfront_baseline bl
  ON b.day_of_week = bl.day_of_week AND b.clock = bl.clock
LEFT JOIN ext_weather_hourly w
  ON date_trunc('HOUR', b.slot_start) = w.obs_hour;

-- Table to train on: gold bins plus holiday / fifa ids for that half hour.
CREATE OR REFRESH MATERIALIZED VIEW gold_waterfront_bins_30m_with_events
COMMENT 'Same gold bins plus event_ids from holiday and fifa windows. Use this for training.'
AS
SELECT
  g.slot_start,
  g.day_of_week,
  g.clock,
  g.volume,
  g.dwell_minutes,
  g.mean_dwell_minutes,
  g.p90_dwell_minutes,
  g.usual_volume,
  g.usual_dwell_minutes,
  g.rain,
  g.temp_c,
  g.precip_mm,
  g.rain_mm,
  COALESCE(e.event_ids, CAST(array() AS ARRAY<STRING>)) AS event_ids
FROM gold_waterfront_bins_30m g
LEFT JOIN (
  SELECT
    b.slot_start,
    SORT_ARRAY(COLLECT_SET(o.event_id)) AS event_ids
  FROM gold_waterfront_bins_30m b
  JOIN ext_event_occurrences o
    ON b.slot_start >= o.starts_at AND b.slot_start < o.ends_at
  JOIN dim_events d
    ON o.event_id = d.event_id AND d.is_active
  GROUP BY b.slot_start
) e ON g.slot_start = e.slot_start;
