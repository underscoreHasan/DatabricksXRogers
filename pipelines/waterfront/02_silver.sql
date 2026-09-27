-- Silver: Waterfront only, one row per 30-minute slot.
CREATE OR REFRESH MATERIALIZED VIEW silver_waterfront_bins_30m
(
  CONSTRAINT volume_non_negative EXPECT (volume >= 0) ON VIOLATION FAIL UPDATE,
  CONSTRAINT dwell_sane EXPECT (dwell_minutes IS NULL OR dwell_minutes BETWEEN 0 AND 1440) ON VIOLATION DROP ROW
)
COMMENT 'Waterfront 30-minute bins for MODEL-V1. Volume = ping count. Dwell = typical stay (median minutes).'
AS
SELECT
  CAST(
    date_trunc('HOUR', timestamp) + (FLOOR(MINUTE(timestamp) / 30) * INTERVAL 30 MINUTES)
    AS TIMESTAMP
  ) AS slot_start,
  LOWER(date_format(
    date_trunc('HOUR', timestamp) + (FLOOR(MINUTE(timestamp) / 30) * INTERVAL 30 MINUTES),
    'EEEE'
  )) AS day_of_week,
  date_format(
    date_trunc('HOUR', timestamp) + (FLOOR(MINUTE(timestamp) / 30) * INTERVAL 30 MINUTES),
    'HH:mm'
  ) AS clock,
  COUNT(*) AS volume,
  CAST(PERCENTILE(dwell_time, 0.5) AS DOUBLE) AS dwell_minutes,
  CAST(AVG(dwell_time) AS DOUBLE) AS mean_dwell_minutes,
  CAST(PERCENTILE(dwell_time, 0.9) AS DOUBLE) AS p90_dwell_minutes
FROM bronze_cell_towers
WHERE location_name = 'Waterfront Station'
GROUP BY 1, 2, 3;
