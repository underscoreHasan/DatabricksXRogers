"""Build staging CSVs for dim_events / ext_event_occurrences. Does not write to Databricks."""

from __future__ import annotations

import csv
from datetime import date, datetime, timedelta
from pathlib import Path

OUT = Path(__file__).resolve().parent
WINDOW_START = date(2025, 11, 1)
WINDOW_END = date(2026, 8, 31)
LARGE_HOURS = 5  # same fallback the live API uses for large venues


def add_hours(start: datetime, hours: float) -> datetime:
    return start + timedelta(hours=hours)


def in_window(d: date) -> bool:
    return WINDOW_START <= d <= WINDOW_END


OCC_FIELDS = [
    "event_id",
    "starts_at",
    "ends_at",
    "local_date",
    "venue",
    "opponent_or_name",
    "time_source",
    "source",
    "notes",
]


def row(
    event_id: str,
    start: datetime,
    hours: float,
    venue: str,
    name: str,
    time_source: str,
    source: str,
    notes: str = "",
) -> dict[str, str]:
    end = add_hours(start, hours)
    return {
        "event_id": event_id,
        "starts_at": start.strftime("%Y-%m-%dT%H:%M:%S"),
        "ends_at": end.strftime("%Y-%m-%dT%H:%M:%S"),
        "local_date": start.date().isoformat(),
        "venue": venue,
        "opponent_or_name": name,
        "time_source": time_source,
        "source": source,
        "notes": notes,
    }


def canucks() -> list[dict[str, str]]:
    # Home games from hockey-reference.com/teams/VAN/2026_games.html (blank @ column).
    # Kickoffs: NHL.com announcement + Ticketmaster listings where known; else 19:00 PT.
    known = {
        date(2025, 11, 11): ("19:00", "nhl.com_schedule_release"),
        date(2026, 1, 17): ("19:00", "nhl.com_schedule_release"),
        date(2026, 1, 21): ("19:00", "nhl.com_schedule_release"),
        date(2026, 1, 31): ("16:00", "nhl.com_schedule_release"),
        date(2026, 3, 2): ("19:00", "nhl.com_schedule_release"),
        date(2026, 3, 9): ("18:00", "ticketmaster"),
        date(2026, 3, 12): ("19:00", "ticketmaster"),
        date(2026, 3, 14): ("19:00", "ticketmaster"),
        date(2026, 3, 17): ("19:00", "nhl.com_schedule_release"),
        date(2026, 3, 21): ("16:00", "ticketmaster"),
        date(2026, 3, 26): ("19:00", "nhl.com_schedule_release"),
        date(2026, 4, 14): ("19:00", "nhl.com_schedule_release"),
    }
    games = [
        (date(2025, 11, 5), "Chicago Blackhawks"),
        (date(2025, 11, 8), "Columbus Blue Jackets"),
        (date(2025, 11, 9), "Colorado Avalanche"),
        (date(2025, 11, 11), "Winnipeg Jets"),
        (date(2025, 11, 20), "Dallas Stars"),
        (date(2025, 11, 23), "Calgary Flames"),
        (date(2025, 12, 5), "Utah Mammoth"),
        (date(2025, 12, 6), "Minnesota Wild"),
        (date(2025, 12, 8), "Detroit Red Wings"),
        (date(2025, 12, 11), "Buffalo Sabres"),
        (date(2025, 12, 27), "San Jose Sharks"),
        (date(2025, 12, 30), "Philadelphia Flyers"),
        (date(2026, 1, 2), "Seattle Kraken"),
        (date(2026, 1, 3), "Boston Bruins"),
        (date(2026, 1, 17), "Edmonton Oilers"),
        (date(2026, 1, 19), "New York Islanders"),
        (date(2026, 1, 21), "Washington Capitals"),
        (date(2026, 1, 23), "New Jersey Devils"),
        (date(2026, 1, 25), "Pittsburgh Penguins"),
        (date(2026, 1, 27), "San Jose Sharks"),
        (date(2026, 1, 29), "Anaheim Ducks"),
        (date(2026, 1, 31), "Toronto Maple Leafs"),
        (date(2026, 2, 25), "Winnipeg Jets"),
        (date(2026, 3, 2), "Dallas Stars"),
        (date(2026, 3, 4), "Carolina Hurricanes"),
        (date(2026, 3, 9), "Ottawa Senators"),
        (date(2026, 3, 12), "Nashville Predators"),
        (date(2026, 3, 14), "Seattle Kraken"),
        (date(2026, 3, 17), "Florida Panthers"),
        (date(2026, 3, 19), "Tampa Bay Lightning"),
        (date(2026, 3, 21), "St. Louis Blues"),
        (date(2026, 3, 24), "Anaheim Ducks"),
        (date(2026, 3, 26), "Los Angeles Kings"),
        (date(2026, 4, 4), "Utah Mammoth"),
        (date(2026, 4, 7), "Vegas Golden Knights"),
        (date(2026, 4, 14), "Los Angeles Kings"),
    ]
    out = []
    for d, opp in games:
        if not in_window(d):
            continue
        hhmm, src = known.get(d, ("19:00", "assumed_1900_pt"))
        h, m = map(int, hhmm.split(":"))
        start = datetime(d.year, d.month, d.day, h, m)
        out.append(row("large_event", start, LARGE_HOURS, "Rogers Arena", f"Canucks vs {opp}", src, "hockey-reference VAN 2026 games + NHL.com times"))
    return out


def whitecaps() -> list[dict[str, str]]:
    games = [
        (datetime(2025, 11, 22, 19, 0), "LAFC (MLS Cup Playoffs)", "assumed_1900_pt", "playoff recap; kickoff not on recap"),
        (datetime(2026, 2, 21, 16, 30), "Real Salt Lake", "whitecapsfc.com", ""),
        (datetime(2026, 2, 25, 18, 0), "Cartagines (Champions Cup)", "wikipedia_match_report", ""),
        (datetime(2026, 2, 28, 18, 30), "Toronto FC", "whitecapsfc.com", ""),
        (datetime(2026, 3, 12, 19, 0), "Seattle Sounders (Champions Cup)", "wikipedia_match_report", ""),
        (datetime(2026, 3, 15, 13, 30), "Minnesota United", "wikipedia_match_report", "rescheduled from Mar 14"),
        (datetime(2026, 3, 21, 19, 30), "San Jose Earthquakes", "whitecapsfc.com", ""),
        (datetime(2026, 4, 4, 19, 30), "Portland Timbers", "whitecapsfc.com", ""),
        (datetime(2026, 4, 11, 16, 30), "NYCFC", "whitecapsfc.com", ""),
        (datetime(2026, 4, 17, 19, 30), "Sporting Kansas City", "whitecapsfc.com", ""),
        (datetime(2026, 4, 25, 19, 30), "Colorado Rapids", "whitecapsfc.com", ""),
        (datetime(2026, 8, 1, 16, 30), "Los Angeles FC", "whitecapsfc.com", ""),
        (datetime(2026, 8, 4, 19, 30), "Atlante (Leagues Cup)", "wikipedia_match_report", ""),
        (datetime(2026, 8, 7, 19, 30), "Juarez (Leagues Cup)", "wikipedia_match_report", ""),
        (datetime(2026, 8, 19, 19, 30), "Houston Dynamo", "whitecapsfc.com", ""),
        (datetime(2026, 8, 22, 18, 30), "FC Dallas", "whitecapsfc.com", ""),
    ]
    out = []
    for start, name, src, notes in games:
        if not in_window(start.date()):
            continue
        out.append(row("large_event", start, LARGE_HOURS, "BC Place", f"Whitecaps vs {name}", src, "whitecapsfc.com / wikipedia 2026 season", notes))
    return out


def lions() -> list[dict[str, str]]:
    # CFL media guide: Jun 27 and Jul 4 home games were at Apple Bowl, Kelowna — excluded.
    games = [
        (datetime(2026, 7, 25, 16, 0), "Toronto Argonauts"),
        (datetime(2026, 8, 8, 16, 0), "Hamilton Tiger-Cats"),
        (datetime(2026, 8, 23, 16, 0), "Saskatchewan Roughriders"),
    ]
    return [
        row("large_event", start, LARGE_HOURS, "BC Place", f"Lions vs {opp}", "bcplace.com / CFL media guide", "CFL 2026 media guide")
        for start, opp in games
        if in_window(start.date())
    ]


def fifa() -> list[dict[str, str]]:
    # Group times match BC Place Dec 2025 release. Jul 7 kickoff was later listed as 20:00 PDT
    # by FanVancouver after the tournament (BC Place pre-draw note said 13:00 PT).
    matches = [
        (datetime(2026, 6, 13, 21, 0), "Australia vs Turkiye", "bcplace.com + fanvancouver PDT"),
        (datetime(2026, 6, 18, 15, 0), "Canada vs Qatar", "bcplace.com + fanvancouver PDT"),
        (datetime(2026, 6, 21, 18, 0), "New Zealand vs Egypt", "bcplace.com + fanvancouver PDT"),
        (datetime(2026, 6, 24, 12, 0), "Switzerland vs Canada", "bcplace.com + fanvancouver PDT"),
        (datetime(2026, 6, 26, 20, 0), "New Zealand vs Belgium", "bcplace.com + fanvancouver PDT"),
        (datetime(2026, 7, 2, 20, 0), "Switzerland vs Algeria (R32)", "fanvancouver PDT"),
        (datetime(2026, 7, 7, 20, 0), "Switzerland vs Colombia (R16)", "fanvancouver PDT; conflicts with earlier 13:00 PT placeholder"),
    ]
    return [
        row("fifa", start, LARGE_HOURS, "BC Place", name, src, "FIFA.com / BC Place / FanVancouver")
        for start, name, src in matches
        if in_window(start.date())
    ]


def holidays() -> list[dict[str, str]]:
    days = [
        (date(2025, 11, 11), "Remembrance Day"),
        (date(2025, 12, 25), "Christmas Day"),
        (date(2025, 12, 26), "Boxing Day"),
        (date(2026, 1, 1), "New Year's Day"),
        (date(2026, 2, 16), "Family Day (BC)"),
        (date(2026, 4, 3), "Good Friday"),
        (date(2026, 5, 18), "Victoria Day"),
        (date(2026, 7, 1), "Canada Day"),
        (date(2026, 8, 3), "BC Day"),
    ]
    out = []
    for d, name in days:
        if not in_window(d):
            continue
        start = datetime(d.year, d.month, d.day, 0, 0)
        out.append(row("holiday", start, 24, "", name, "all_day", "BC statutory holiday calendar", "all-day local; quieter commute, not a festival"))
    return out


def dim_rows() -> list[dict[str, str]]:
    return [
        {
            "event_id": "large_event",
            "name": "Large downtown event",
            "description": "BC Place or Rogers Arena: Canucks, Whitecaps, Lions. Not FIFA.",
            "category": "sport",
            "site_scope": "all",
            "default_span": "custom",
            "is_active": "true",
            "source": "hockey-reference, whitecapsfc.com, CFL media guide",
        },
        {
            "event_id": "fifa",
            "name": "FIFA World Cup at BC Place",
            "description": "2026 World Cup match at BC Place. Do not also send large_event.",
            "category": "sport",
            "site_scope": "all",
            "default_span": "custom",
            "is_active": "true",
            "source": "FIFA.com / BC Place",
        },
        {
            "event_id": "holiday",
            "name": "Public holiday",
            "description": "BC statutory holiday. In this data, Waterfront is usually quieter.",
            "category": "civic",
            "site_scope": "waterfront",
            "default_span": "all_day",
            "is_active": "true",
            "source": "BC statutory calendar",
        },
    ]


def main() -> None:
    occ = canucks() + whitecaps() + lions() + fifa() + holidays()
    occ.sort(key=lambda r: (r["local_date"], r["starts_at"], r["event_id"]))
    with (OUT / "dim_events.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(dim_rows()[0].keys()))
        w.writeheader()
        w.writerows(dim_rows())
    with (OUT / "ext_event_occurrences.csv").open("w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=OCC_FIELDS)
        w.writeheader()
        w.writerows(occ)
    print(f"wrote {len(dim_rows())} dim rows, {len(occ)} occurrences")
    for eid in ("large_event", "fifa", "holiday"):
        n = sum(1 for r in occ if r["event_id"] == eid)
        assumed = sum(1 for r in occ if r["event_id"] == eid and r["time_source"].startswith("assumed"))
        print(f"  {eid}: {n} rows, {assumed} assumed kickoffs")


if __name__ == "__main__":
    main()
