CREATE OR REFRESH MATERIALIZED VIEW silver_gtfs_service_dates
COMMENT 'Operating dates per service_id after calendar weekday flags and calendar_dates exceptions.'
AS
WITH expanded AS (
  SELECT
    c.snapshot_id,
    c.service_id,
    explode(
      sequence(c.start_date, c.end_date, INTERVAL 1 DAY)
    ) AS service_date,
    c.monday,
    c.tuesday,
    c.wednesday,
    c.thursday,
    c.friday,
    c.saturday,
    c.sunday
  FROM bronze_gtfs_calendar c
),
weekday_hits AS (
  SELECT snapshot_id, service_id, service_date
  FROM expanded
  WHERE (
    (dayofweek(service_date) = 2 AND monday = 1)
    OR (dayofweek(service_date) = 3 AND tuesday = 1)
    OR (dayofweek(service_date) = 4 AND wednesday = 1)
    OR (dayofweek(service_date) = 5 AND thursday = 1)
    OR (dayofweek(service_date) = 6 AND friday = 1)
    OR (dayofweek(service_date) = 7 AND saturday = 1)
    OR (dayofweek(service_date) = 1 AND sunday = 1)
  )
),
removed AS (
  SELECT snapshot_id, service_id, service_date
  FROM bronze_gtfs_calendar_dates
  WHERE exception_type = 2
),
added AS (
  SELECT snapshot_id, service_id, service_date
  FROM bronze_gtfs_calendar_dates
  WHERE exception_type = 1
)
SELECT snapshot_id, service_id, service_date FROM weekday_hits
EXCEPT
SELECT snapshot_id, service_id, service_date FROM removed
UNION
SELECT snapshot_id, service_id, service_date FROM added;

CREATE OR REFRESH MATERIALIZED VIEW silver_gtfs_waterfront_departures
COMMENT 'One scheduled vehicle visit at a Waterfront platform or bay. Entrances and the parent station are excluded.'
AS
SELECT
  st.snapshot_id,
  d.service_date,
  CAST(d.service_date AS TIMESTAMP)
    + (
        CAST(split_part(COALESCE(NULLIF(st.departure_time, ''), st.arrival_time), ':', 1) AS INT) * 3600
        + CAST(split_part(COALESCE(NULLIF(st.departure_time, ''), st.arrival_time), ':', 2) AS INT) * 60
        + CAST(split_part(COALESCE(NULLIF(st.departure_time, ''), st.arrival_time), ':', 3) AS INT)
      ) * INTERVAL 1 SECOND AS depart_at,
  st.trip_id,
  st.stop_id,
  st.stop_sequence,
  st.departure_time AS gtfs_departure_time,
  st.arrival_time AS gtfs_arrival_time,
  COALESCE(st.pickup_type, 0) AS pickup_type,
  t.route_id,
  t.service_id,
  t.direction_id,
  t.trip_headsign,
  t.shape_id,
  r.route_short_name,
  r.route_long_name,
  r.route_type,
  CASE r.route_type
    WHEN 1 THEN 'skytrain'
    WHEN 2 THEN 'west_coast_express'
    WHEN 3 THEN 'bus'
    WHEN 4 THEN 'seabus'
    ELSE 'other'
  END AS mode,
  s.stop_name,
  s.stop_lat,
  s.stop_lon
FROM bronze_gtfs_stop_times st
JOIN bronze_gtfs_trips t
  ON st.snapshot_id = t.snapshot_id AND st.trip_id = t.trip_id
JOIN bronze_gtfs_routes r
  ON t.snapshot_id = r.snapshot_id AND t.route_id = r.route_id
JOIN bronze_gtfs_stops s
  ON st.snapshot_id = s.snapshot_id AND st.stop_id = s.stop_id
JOIN silver_gtfs_service_dates d
  ON st.snapshot_id = d.snapshot_id AND t.service_id = d.service_id
WHERE COALESCE(s.location_type, 0) = 0
  AND COALESCE(NULLIF(st.departure_time, ''), st.arrival_time) IS NOT NULL
  AND COALESCE(NULLIF(st.departure_time, ''), st.arrival_time) RLIKE '^[0-9]{1,2}:[0-9]{2}:[0-9]{2}$';
