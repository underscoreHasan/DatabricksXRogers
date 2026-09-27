-- Snapshot manifest, one row per GTFS zip we landed.
CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_snapshots
COMMENT 'Which TransLink GTFS snapshots are on the volume. One folder per snapshot_id.'
AS
SELECT
  snapshot_id,
  source,
  source_url,
  to_timestamp(retrieved_at) AS retrieved_at,
  to_date(feed_start_date, 'yyyyMMdd') AS feed_start_date,
  to_date(feed_end_date, 'yyyyMMdd') AS feed_end_date,
  CAST(n_stops AS INT) AS n_stops,
  CAST(n_stop_times AS INT) AS n_stop_times,
  CAST(n_trips AS INT) AS n_trips,
  CAST(n_routes AS INT) AS n_routes,
  coverage_note,
  to_timestamp(extracted_at) AS extracted_at,
  _metadata.file_path AS file_path
FROM read_files(
  '${gtfs_glob}/*/snapshot.csv',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_agency
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  agency_id,
  agency_name,
  agency_url,
  agency_timezone,
  agency_lang
FROM read_files(
  '${gtfs_glob}/*/agency.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_feed_info
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  feed_publisher_name,
  feed_publisher_url,
  feed_lang,
  to_date(feed_start_date, 'yyyyMMdd') AS feed_start_date,
  to_date(feed_end_date, 'yyyyMMdd') AS feed_end_date,
  feed_version
FROM read_files(
  '${gtfs_glob}/*/feed_info.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_signup_periods
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  sign_id,
  to_date(from_date, 'yyyyMMdd') AS from_date,
  to_date(to_date, 'yyyyMMdd') AS to_date
FROM read_files(
  '${gtfs_glob}/*/signup_periods.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_calendar
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  service_id,
  CAST(monday AS INT) AS monday,
  CAST(tuesday AS INT) AS tuesday,
  CAST(wednesday AS INT) AS wednesday,
  CAST(thursday AS INT) AS thursday,
  CAST(friday AS INT) AS friday,
  CAST(saturday AS INT) AS saturday,
  CAST(sunday AS INT) AS sunday,
  to_date(start_date, 'yyyyMMdd') AS start_date,
  to_date(end_date, 'yyyyMMdd') AS end_date
FROM read_files(
  '${gtfs_glob}/*/calendar.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_calendar_dates
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  service_id,
  to_date(date, 'yyyyMMdd') AS service_date,
  CAST(exception_type AS INT) AS exception_type
FROM read_files(
  '${gtfs_glob}/*/calendar_dates.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_routes
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  route_id,
  agency_id,
  route_short_name,
  route_long_name,
  route_desc,
  CAST(route_type AS INT) AS route_type,
  route_url,
  route_color,
  route_text_color
FROM read_files(
  '${gtfs_glob}/*/routes.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_stops
(
  CONSTRAINT stop_id_present EXPECT (stop_id IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'Waterfront Station stops, platforms, bays, and entrances from each GTFS snapshot.'
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  stop_id,
  stop_code,
  stop_name,
  stop_desc,
  CAST(stop_lat AS DOUBLE) AS stop_lat,
  CAST(stop_lon AS DOUBLE) AS stop_lon,
  zone_id,
  stop_url,
  CAST(NULLIF(location_type, '') AS INT) AS location_type,
  parent_station,
  CAST(NULLIF(wheelchair_boarding, '') AS INT) AS wheelchair_boarding
FROM read_files(
  '${gtfs_glob}/*/stops.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_trips
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  route_id,
  service_id,
  trip_id,
  trip_headsign,
  trip_short_name,
  CAST(NULLIF(direction_id, '') AS INT) AS direction_id,
  block_id,
  shape_id,
  CAST(NULLIF(wheelchair_accessible, '') AS INT) AS wheelchair_accessible,
  CAST(NULLIF(bikes_allowed, '') AS INT) AS bikes_allowed
FROM read_files(
  '${gtfs_glob}/*/trips.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_stop_times
(
  CONSTRAINT trip_stop_present EXPECT (trip_id IS NOT NULL AND stop_id IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'Stop times at Waterfront only. Extracted before upload so this is not the regional file.'
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  trip_id,
  arrival_time,
  departure_time,
  stop_id,
  CAST(stop_sequence AS INT) AS stop_sequence,
  stop_headsign,
  CAST(NULLIF(pickup_type, '') AS INT) AS pickup_type,
  CAST(NULLIF(drop_off_type, '') AS INT) AS drop_off_type,
  CAST(NULLIF(shape_dist_traveled, '') AS DOUBLE) AS shape_dist_traveled,
  CAST(NULLIF(timepoint, '') AS INT) AS timepoint
FROM read_files(
  '${gtfs_glob}/*/stop_times.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);

CREATE OR REFRESH MATERIALIZED VIEW bronze_gtfs_shapes
COMMENT 'Shape points for trips that stop at Waterfront. For a later map, not for the 30-minute counts.'
AS
SELECT
  regexp_extract(_metadata.file_path, 'snapshots/([^/]+)/', 1) AS snapshot_id,
  shape_id,
  CAST(shape_pt_lat AS DOUBLE) AS shape_pt_lat,
  CAST(shape_pt_lon AS DOUBLE) AS shape_pt_lon,
  CAST(shape_pt_sequence AS INT) AS shape_pt_sequence,
  CAST(NULLIF(shape_dist_traveled, '') AS DOUBLE) AS shape_dist_traveled
FROM read_files(
  '${gtfs_glob}/*/shapes.txt',
  format => 'csv',
  header => true,
  inferSchema => false
);
