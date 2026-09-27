-- Event catalog the app/model may send. Only holiday and fifa.
CREATE OR REFRESH MATERIALIZED VIEW dim_events
COMMENT 'Allowed event catalog for MODEL-V1. App picker = event_id, name WHERE is_active.'
AS
SELECT
  event_id,
  name,
  description,
  category,
  site_scope,
  default_span,
  is_active,
  source,
  current_timestamp() AS updated_at
FROM VALUES
  (
    'fifa',
    'FIFA World Cup at BC Place',
    '2026 World Cup match at BC Place.',
    'sport',
    'all',
    'custom',
    true,
    'FIFA.com / BC Place'
  ),
  (
    'holiday',
    'Public holiday',
    'BC statutory holiday. In this data, Waterfront is usually quieter.',
    'civic',
    'waterfront',
    'all_day',
    true,
    'BC statutory calendar'
  ) AS t(event_id, name, description, category, site_scope, default_span, is_active, source);

-- When each event is on. Times are America/Vancouver (same as slot_start).
CREATE OR REFRESH MATERIALIZED VIEW ext_event_occurrences
COMMENT 'Which windows each event_id covers. Join onto gold bins with slot_start >= starts_at AND slot_start < ends_at.'
AS
SELECT
  event_id,
  starts_at,
  ends_at,
  local_date,
  notes
FROM VALUES
  ('holiday', TIMESTAMP '2025-11-11 00:00:00', TIMESTAMP '2025-11-12 00:00:00', DATE '2025-11-11', 'Remembrance Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2025-12-25 00:00:00', TIMESTAMP '2025-12-26 00:00:00', DATE '2025-12-25', 'Christmas Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2025-12-26 00:00:00', TIMESTAMP '2025-12-27 00:00:00', DATE '2025-12-26', 'Boxing Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-01-01 00:00:00', TIMESTAMP '2026-01-02 00:00:00', DATE '2026-01-01', 'New Year''s Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-02-16 00:00:00', TIMESTAMP '2026-02-17 00:00:00', DATE '2026-02-16', 'Family Day (BC). All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-04-03 00:00:00', TIMESTAMP '2026-04-04 00:00:00', DATE '2026-04-03', 'Good Friday. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-05-18 00:00:00', TIMESTAMP '2026-05-19 00:00:00', DATE '2026-05-18', 'Victoria Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-07-01 00:00:00', TIMESTAMP '2026-07-02 00:00:00', DATE '2026-07-01', 'Canada Day. All-day America/Vancouver.'),
  ('holiday', TIMESTAMP '2026-08-03 00:00:00', TIMESTAMP '2026-08-04 00:00:00', DATE '2026-08-03', 'BC Day. All-day America/Vancouver.'),
  ('fifa', TIMESTAMP '2026-06-13 21:00:00', TIMESTAMP '2026-06-14 02:00:00', DATE '2026-06-13', 'Australia vs Turkiye at BC Place. Kickoff 21:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-06-18 15:00:00', TIMESTAMP '2026-06-18 20:00:00', DATE '2026-06-18', 'Canada vs Qatar at BC Place. Kickoff 15:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-06-21 18:00:00', TIMESTAMP '2026-06-21 23:00:00', DATE '2026-06-21', 'New Zealand vs Egypt at BC Place. Kickoff 18:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-06-24 12:00:00', TIMESTAMP '2026-06-24 17:00:00', DATE '2026-06-24', 'Switzerland vs Canada at BC Place. Kickoff 12:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-06-26 20:00:00', TIMESTAMP '2026-06-27 01:00:00', DATE '2026-06-26', 'New Zealand vs Belgium at BC Place. Kickoff 20:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-07-02 20:00:00', TIMESTAMP '2026-07-03 01:00:00', DATE '2026-07-02', 'Switzerland vs Algeria (R32) at BC Place. Kickoff 20:00 PT. End = start + 5h.'),
  ('fifa', TIMESTAMP '2026-07-07 20:00:00', TIMESTAMP '2026-07-08 01:00:00', DATE '2026-07-07', 'Switzerland vs Colombia (R16) at BC Place. Kickoff 20:00 PT. End = start + 5h.')
  AS t(event_id, starts_at, ends_at, local_date, notes);
