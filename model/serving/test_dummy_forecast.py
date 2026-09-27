from __future__ import annotations

import unittest

from dummy_forecast import (
    ForecastError,
    bc_holidays,
    forecast,
    parse_records,
)


class ParseTests(unittest.TestCase):
    def test_requires_dataframe_records(self):
        with self.assertRaisesRegex(ForecastError, "non-empty list"):
            parse_records([])
        with self.assertRaisesRegex(ForecastError, "non-empty list"):
            parse_records("nope")

    def test_missing_or_invalid_date(self):
        for row in ({}, {"date": "2026-9-12"}, {"date": "2026-02-30"}, {"date": "2026-09-12T00:00:00"}):
            with self.assertRaisesRegex(ForecastError, "Missing date or not YYYY-MM-DD"):
                parse_records([row])

    def test_slot_start_offset_is_ignored_not_converted(self):
        parsed = parse_records([{"date": "2026-09-13", "slot_start": "2026-09-13T18:07:00+00:00"}])
        self.assertEqual(parsed[0]["slot"], 36)

    def test_slot_start_rounds_down(self):
        parsed = parse_records([{"date": "2026-09-13", "slot_start": "2026-09-13T18:29:59"}])
        self.assertEqual(parsed[0]["slot"], 36)

    def test_slot_on_another_date_is_ignored_but_date_is_kept(self):
        rows = forecast([{"date": "2026-09-12", "slot_start": "2026-09-13T18:00:00", "rain": True}])
        self.assertEqual(len(rows), 48)
        self.assertEqual(rows[0]["date"], "2026-09-12")
        self.assertFalse(any(row["clock"] == "18:00" and "large" in "".join(row["events"]) for row in rows))

    def test_bad_slot_start(self):
        with self.assertRaisesRegex(ForecastError, "slot_start"):
            parse_records([{"date": "2026-09-13", "slot_start": "18:00"}])

    def test_bad_rain_and_event_ids(self):
        with self.assertRaisesRegex(ForecastError, "rain must be a boolean"):
            parse_records([{"date": "2026-09-13", "rain": 1}])
        with self.assertRaisesRegex(ForecastError, "event_ids"):
            parse_records([{"date": "2026-09-13", "event_ids": "large_canucks_game"}])
        with self.assertRaisesRegex(ForecastError, "temp_c"):
            parse_records([{"date": "2026-09-13", "temp_c": "warm"}])


class ForecastTests(unittest.TestCase):
    def test_one_date_returns_48_sorted_slots(self):
        rows = forecast([{"date": "2026-09-01"}])
        self.assertEqual(len(rows), 48)
        self.assertEqual(rows[0]["slot_start"], "2026-09-01T00:00:00")
        self.assertEqual(rows[-1]["slot_start"], "2026-09-01T23:30:00")
        self.assertEqual([row["clock"] for row in rows], [row["slot_start"][11:16] for row in rows])
        self.assertTrue(all(row["model"] == "week_ahead" and row["confidence"] == "high" for row in rows))

    def test_two_dates(self):
        rows = forecast([{"date": "2026-09-13"}, {"date": "2026-09-12"}])
        self.assertEqual(len(rows), 96)
        self.assertEqual(rows[0]["date"], "2026-09-12")
        self.assertEqual(rows[48]["date"], "2026-09-13")

    def test_slot_override_and_unknown_events(self):
        rows = forecast([
            {"date": "2026-09-13"},
            {"date": "2026-09-13", "slot_start": "2026-09-13T18:00:00",
             "rain": True, "event_ids": ["large_canucks_game", "community_fair"]},
        ])
        six = next(row for row in rows if row["clock"] == "18:00")
        half = next(row for row in rows if row["clock"] == "18:30")
        self.assertEqual(six["events"], ["large_canucks_game", "community_fair"])
        self.assertEqual(half["events"], [])
        self.assertEqual(six["volume_p50"], six["usual_volume"])
        self.assertEqual(six["volume_p10"], six["volume_p90"])
        self.assertEqual(six["vs_usual_pct"], 0.0)

    def test_labour_day_is_auto_holiday_and_week_ahead(self):
        rows = forecast([{"date": "2026-09-07"}])
        self.assertTrue(all(row["is_holiday"] == 1 for row in rows))
        self.assertTrue(all(row["events"][0] == "holiday" for row in rows))
        self.assertEqual(rows[0]["model"], "week_ahead")
        self.assertEqual(rows[12]["volume_p50"], rows[12]["usual_volume"])
        self.assertEqual(rows[12]["vs_usual_pct"], 0.0)

    def test_horizons(self):
        self.assertEqual(forecast([{"date": "2026-09-07"}])[0]["model"], "week_ahead")
        self.assertEqual(forecast([{"date": "2026-09-08"}])[0]["model"], "month_ahead")
        self.assertEqual(forecast([{"date": "2026-10-05"}])[0]["confidence"], "medium")
        self.assertEqual(forecast([{"date": "2026-10-06"}])[0]["model"], "outlook")
        self.assertEqual(forecast([{"date": "2026-10-06"}])[0]["confidence"], "low")
        self.assertEqual(forecast([{"date": "2026-11-01"}])[0]["confidence"], "medium-low")

    def test_bc_holidays_2026(self):
        days = bc_holidays(2026)
        self.assertIn(__import__("datetime").date(2026, 4, 3), days)
        self.assertIn(__import__("datetime").date(2026, 9, 7), days)
        self.assertIn(__import__("datetime").date(2026, 7, 1), days)


if __name__ == "__main__":
    unittest.main()
