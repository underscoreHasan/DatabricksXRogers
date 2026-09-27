-- External weather: Open-Meteo hourly archive already landed on the volume.
CREATE OR REFRESH MATERIALIZED VIEW ext_weather_hourly
(
  CONSTRAINT hour_present EXPECT (obs_hour IS NOT NULL) ON VIOLATION DROP ROW
)
COMMENT 'Hourly weather at Waterfront (Open-Meteo archive). Join onto 30-min bins by hour of slot_start.'
AS
SELECT
  to_timestamp(obs_hour) AS obs_hour,
  CAST(temp_c AS DOUBLE) AS temp_c,
  CAST(precip_mm AS DOUBLE) AS precip_mm,
  CAST(rain_mm AS DOUBLE) AS rain_mm,
  CAST(weather_code AS INT) AS weather_code,
  CAST(rain_mm AS DOUBLE) > 0 AS rain,
  CAST(lat AS DOUBLE) AS lat,
  CAST(lon AS DOUBLE) AS lon,
  source
FROM read_files(
  '${weather_path}',
  format => 'csv',
  header => true
);
