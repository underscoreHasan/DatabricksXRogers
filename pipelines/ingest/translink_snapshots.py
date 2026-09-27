"""Download TransLink GTFS snapshots and write a Waterfront-only extract.

Uploads nothing. Writes to --out (default /tmp/translink-gtfs-extract/snapshots).
Copy that folder onto the UC volume, then refresh the translink-gtfs pipeline.

Coverage we can get without a Transitland/Mobility Database key:

  wayback_20250830  2025-09-01 to 2026-01-04   (also includes summer 2025)
  mdb_20260604      2026-04-20 to 2026-09-06
  current_20260925  2026-09-07 to 2027-01-03

Gap: 2026-01-05 through 2026-04-19. No public archive snapshot for that signup.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import urllib.request
import zipfile
from datetime import datetime, timezone
from pathlib import Path

WATERFRONT = "waterfront"
SNAPSHOTS = (
    {
        "snapshot_id": "wayback_20250830",
        "source": "internet_archive",
        "url": "https://web.archive.org/web/20250830192448id_/https://gtfs-static.translink.ca/gtfs/google_transit.zip",
        "retrieved_at": "2025-08-30T19:24:48Z",
        "coverage_note": "Signups 2025-06-23..2025-08-31 and 2025-09-01..2026-01-04. Use for ping window Nov–Jan.",
    },
    {
        "snapshot_id": "mdb_20260604",
        "source": "mobility_database_latest",
        "url": "https://storage.googleapis.com/storage/v1/b/mdb-latest/o/ca-british-columbia-translink-west-coast-express-gtfs-696.zip?alt=media",
        "retrieved_at": "2026-06-04T01:15:28Z",
        "coverage_note": "Signups 2026-04-20..2026-06-07 and 2026-06-08..2026-09-06. Use for ping window Apr–Aug.",
    },
    {
        "snapshot_id": "current_20260925",
        "source": "translink_gtfs_static",
        "url": "https://gtfs-static.translink.ca/gtfs/google_transit.zip",
        "retrieved_at": "2026-09-25T06:31:00Z",
        "coverage_note": "Signup 2026-09-07..2027-01-03. Future timetable for the app.",
    },
)


def download(url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.exists() and dest.stat().st_size > 1_000_000:
        return
    req = urllib.request.Request(url, headers={"User-Agent": "databricksxrogers-translink-ingest/1"})
    with urllib.request.urlopen(req, timeout=180) as resp, dest.open("wb") as out:
        while True:
            chunk = resp.read(1024 * 1024)
            if not chunk:
                break
            out.write(chunk)


def read_gtfs_csv(zf: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    try:
        info = zf.getinfo(name)
    except KeyError:
        return []
    text = zf.read(info).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str] | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if not rows and not fieldnames:
        path.write_text("", encoding="utf-8")
        return
    names = fieldnames or list(rows[0].keys())
    with path.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=names, extrasaction="ignore", lineterminator="\n")
        w.writeheader()
        for row in rows:
            w.writerow({k: row.get(k, "") for k in names})


def waterfront_stop_ids(stops: list[dict[str, str]]) -> set[str]:
    named = {s["stop_id"] for s in stops if WATERFRONT in (s.get("stop_name") or "").lower()}
    parents = {s.get("parent_station") or "" for s in stops if s["stop_id"] in named}
    parents.discard("")
    children = {
        s["stop_id"]
        for s in stops
        if (s.get("parent_station") or "") in named or (s.get("parent_station") or "") in parents
    }
    return named | parents | children


def extract_snapshot(zip_path: Path, out_dir: Path, meta: dict[str, str]) -> dict[str, str]:
    snapshot_id = meta["snapshot_id"]
    dest = out_dir / snapshot_id
    dest.mkdir(parents=True, exist_ok=True)

    with zipfile.ZipFile(zip_path) as zf:
        stops = read_gtfs_csv(zf, "stops.txt")
        keep_stops = waterfront_stop_ids(stops)
        if not keep_stops:
            raise SystemExit(f"{snapshot_id}: no Waterfront stops")

        stop_times: list[dict[str, str]] = []
        try:
            st_info = zf.getinfo("stop_times.txt")
        except KeyError as exc:
            raise SystemExit(f"{snapshot_id}: missing stop_times.txt") from exc
        with zf.open(st_info) as raw:
            text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
            reader = csv.DictReader(text)
            st_fields = list(reader.fieldnames or [])
            for row in reader:
                if row.get("stop_id") in keep_stops:
                    stop_times.append(row)

        trip_ids = {r["trip_id"] for r in stop_times}
        trips = [t for t in read_gtfs_csv(zf, "trips.txt") if t.get("trip_id") in trip_ids]
        trip_fields = list(trips[0].keys()) if trips else []
        route_ids = {t.get("route_id") for t in trips}
        service_ids = {t.get("service_id") for t in trips}
        shape_ids = {t.get("shape_id") for t in trips if t.get("shape_id")}

        routes = [r for r in read_gtfs_csv(zf, "routes.txt") if r.get("route_id") in route_ids]
        calendar = [r for r in read_gtfs_csv(zf, "calendar.txt") if r.get("service_id") in service_ids]
        calendar_dates = [
            r for r in read_gtfs_csv(zf, "calendar_dates.txt") if r.get("service_id") in service_ids
        ]
        agency = read_gtfs_csv(zf, "agency.txt")
        signup = read_gtfs_csv(zf, "signup_periods.txt")
        feed_info = read_gtfs_csv(zf, "feed_info.txt")

        shapes: list[dict[str, str]] = []
        shape_fields: list[str] = []
        if shape_ids:
            try:
                sh_info = zf.getinfo("shapes.txt")
            except KeyError:
                sh_info = None
            if sh_info is not None:
                with zf.open(sh_info) as raw:
                    text = io.TextIOWrapper(raw, encoding="utf-8-sig", newline="")
                    reader = csv.DictReader(text)
                    shape_fields = list(reader.fieldnames or [])
                    for row in reader:
                        if row.get("shape_id") in shape_ids:
                            shapes.append(row)

    stops_kept = [s for s in stops if s.get("stop_id") in keep_stops]
    cal_dates = [r["start_date"] for r in calendar] + [r["end_date"] for r in calendar]
    feed_start = min(cal_dates) if cal_dates else ""
    feed_end = max(cal_dates) if cal_dates else ""
    if signup:
        feed_start = min(r.get("from_date") or feed_start for r in signup) or feed_start
        feed_end = max(r.get("to_date") or feed_end for r in signup) or feed_end
    if feed_info:
        feed_start = feed_info[0].get("feed_start_date") or feed_start
        feed_end = feed_info[0].get("feed_end_date") or feed_end

    if not feed_info:
        feed_info = [
            {
                "feed_publisher_name": "TransLink",
                "feed_publisher_url": "https://www.translink.ca",
                "feed_lang": "en",
                "feed_start_date": feed_start,
                "feed_end_date": feed_end,
                "feed_version": snapshot_id,
            }
        ]

    write_csv(dest / "stops.txt", stops_kept)
    write_csv(dest / "stop_times.txt", stop_times, st_fields)
    write_csv(dest / "trips.txt", trips, trip_fields)
    write_csv(dest / "routes.txt", routes)
    write_csv(dest / "calendar.txt", calendar)
    write_csv(dest / "calendar_dates.txt", calendar_dates)
    write_csv(dest / "agency.txt", agency)
    write_csv(dest / "signup_periods.txt", signup)
    write_csv(dest / "feed_info.txt", feed_info)
    write_csv(dest / "shapes.txt", shapes, shape_fields or None)

    snapshot_row = {
        "snapshot_id": snapshot_id,
        "source": meta["source"],
        "source_url": meta["url"],
        "retrieved_at": meta["retrieved_at"],
        "feed_start_date": feed_start,
        "feed_end_date": feed_end,
        "n_stops": str(len(stops_kept)),
        "n_stop_times": str(len(stop_times)),
        "n_trips": str(len(trips)),
        "n_routes": str(len(routes)),
        "coverage_note": meta["coverage_note"],
        "extracted_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    write_csv(dest / "snapshot.csv", [snapshot_row])
    (dest / "snapshot.json").write_text(json.dumps(snapshot_row, indent=2) + "\n", encoding="utf-8")
    return snapshot_row


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--cache", type=Path, default=Path("/tmp/translink-gtfs-raw"))
    p.add_argument("--out", type=Path, default=Path("/tmp/translink-gtfs-extract/snapshots"))
    args = p.parse_args()

    rows = []
    for meta in SNAPSHOTS:
        zip_path = args.cache / f"{meta['snapshot_id']}.zip"
        alias = args.cache / "current.zip"
        if (
            meta["snapshot_id"] == "current_20260925"
            and not zip_path.exists()
            and alias.exists()
        ):
            zip_path.write_bytes(alias.read_bytes())
        print(f"download {meta['snapshot_id']}")
        download(meta["url"], zip_path)
        print(f"extract {meta['snapshot_id']}")
        rows.append(extract_snapshot(zip_path, args.out, meta))

    write_csv(args.out.parent / "snapshots.csv", rows)
    print(f"wrote {args.out}")
    for row in rows:
        print(
            f"  {row['snapshot_id']}  {row['feed_start_date']}..{row['feed_end_date']}  "
            f"stops={row['n_stops']} trips={row['n_trips']} stop_times={row['n_stop_times']}"
        )


if __name__ == "__main__":
    main()
