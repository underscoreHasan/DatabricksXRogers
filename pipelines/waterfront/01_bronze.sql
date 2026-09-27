-- Bronze: raw Rogers ping CSVs from the Unity Catalog volume.
CREATE OR REFRESH MATERIALIZED VIEW bronze_cell_towers
(
  CONSTRAINT location_present EXPECT (location_name IS NOT NULL) ON VIOLATION DROP ROW,
  CONSTRAINT dwell_non_negative EXPECT (dwell_time IS NULL OR dwell_time >= 0) ON VIOLATION DROP ROW
)
COMMENT 'Unified raw pings from hackathon CSVs on UC volume'
AS
SELECT
  location_name,
  longitude,
  latitude,
  timestamp,
  origin,
  CAST(dwell_time AS INT) AS dwell_time
FROM read_files(
  '${bronze_path}',
  format => 'csv',
  header => true
);
