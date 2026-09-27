-- 30-minute Waterfront service, same naive-local timestamp convention as gold_waterfront_bins_30m.
CREATE OR REFRESH MATERIALIZED VIEW gold_waterfront_departures_30m
COMMENT 'Scheduled trips stopping at Waterfront, one row per 30-minute slot per route. Join to ping bins on slot_start.'
AS
SELECT
  snapshot_id,
  CAST(
    date_trunc('HOUR', depart_at)
      + (FLOOR(MINUTE(depart_at) / 30) * INTERVAL 30 MINUTES)
    AS TIMESTAMP
  ) AS slot_start,
  LOWER(date_format(
    date_trunc('HOUR', depart_at) + (FLOOR(MINUTE(depart_at) / 30) * INTERVAL 30 MINUTES),
    'EEEE'
  )) AS day_of_week,
  date_format(
    date_trunc('HOUR', depart_at) + (FLOOR(MINUTE(depart_at) / 30) * INTERVAL 30 MINUTES),
    'HH:mm'
  ) AS clock,
  route_id,
  route_short_name,
  route_long_name,
  route_type,
  mode,
  COUNT(*) AS n_trips,
  COUNT(DISTINCT trip_id) AS n_distinct_trips,
  COUNT(DISTINCT stop_id) AS n_stops
FROM silver_gtfs_waterfront_departures
GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9;

CREATE OR REFRESH MATERIALIZED VIEW gold_waterfront_service_30m
COMMENT 'Waterfront scheduled activity by mode, one row per 30-minute slot. Overlay next to predicted volume.'
AS
SELECT
  snapshot_id,
  slot_start,
  ANY_VALUE(day_of_week) AS day_of_week,
  ANY_VALUE(clock) AS clock,
  SUM(n_trips) AS n_trips,
  SUM(CASE WHEN mode = 'skytrain' THEN n_trips ELSE 0 END) AS n_skytrain,
  SUM(CASE WHEN mode = 'seabus' THEN n_trips ELSE 0 END) AS n_seabus,
  SUM(CASE WHEN mode = 'west_coast_express' THEN n_trips ELSE 0 END) AS n_west_coast_express,
  SUM(CASE WHEN mode = 'bus' THEN n_trips ELSE 0 END) AS n_bus,
  COLLECT_SET(NULLIF(route_short_name, '')) AS route_short_names
FROM gold_waterfront_departures_30m
GROUP BY snapshot_id, slot_start;

CREATE OR REFRESH MATERIALIZED VIEW gold_gtfs_coverage
COMMENT 'Which dates each snapshot actually produced Waterfront trips. Jan 5–Apr 19 2026 is a known hole.'
AS
SELECT
  snapshot_id,
  MIN(DATE(slot_start)) AS min_date,
  MAX(DATE(slot_start)) AS max_date,
  COUNT(*) AS n_slots,
  SUM(n_trips) AS n_trips
FROM gold_waterfront_service_30m
GROUP BY snapshot_id;
