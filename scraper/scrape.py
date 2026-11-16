#!/usr/bin/env python3
"""
Scrape F1 seasons from the Jolpica F1 API (Ergast-compatible) into SQLite.

Usage:
    python3 scraper/scrape.py                         # current season (2026)
    python3 scraper/scrape.py --season 2015-2025      # a range of seasons
    python3 scraper/scrape.py --season 2026 --refresh # pick up newly finished races

Results, qualifying, sprints and the calendar always come from the API.
Lap times, pit stops and per-round standings come from:
  * the Jolpica CSV database dump for past seasons (one download instead of thousands of requests)
  * the API, round by round, for the current season (the dump lags a few weeks)
Override with --details api|dump.

Raw API responses are cached in data/raw/<season>/. Standard library only.
"""
import argparse
import json
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dump_import  # noqa: E402

API = "https://api.jolpi.ca/ergast/f1"
PAGE = 100                 # Jolpica max page size
DELAY = 0.6                # seconds between live requests
ROOT = Path(__file__).resolve().parent.parent
SCHEMA = Path(__file__).resolve().parent / "schema.sql"

_last_call = 0.0


def http_get(url: str) -> dict:
    global _last_call
    for attempt in range(8):
        wait = DELAY - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "f1-stats-scraper/1.0"})
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                backoff = min(60, 5 * 2 ** attempt)
                print(f"    HTTP {e.code}, retrying in {backoff}s", file=sys.stderr)
                time.sleep(backoff)
                continue
            raise
        except urllib.error.URLError as e:
            print(f"    network error {e}, retrying", file=sys.stderr)
            time.sleep(5)
    raise RuntimeError(f"giving up on {url}")


def fetch_all(path: str, cache_dir: Path, use_cache: bool = True) -> list:
    """Fetch every page of an endpoint; returns list of MRData dicts (one per page)."""
    cache = cache_dir / (path.replace("/", "_") + ".json")
    if use_cache and cache.exists():
        return json.loads(cache.read_text())
    pages, offset = [], 0
    while True:
        url = f"{API}/{path}.json?limit={PAGE}&offset={offset}"
        print(f"  GET {url}", flush=True)
        data = http_get(url)["MRData"]
        pages.append(data)
        offset += PAGE
        if offset >= int(data["total"]):
            break
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(pages))
    return pages


def races_from(pages: list) -> dict:
    """Merge paginated RaceTable pages (a race can be split across pages) -> {round: race}."""
    merged = {}
    for p in pages:
        for race in p["RaceTable"]["Races"]:
            key = int(race["round"])
            if key not in merged:
                merged[key] = race
            else:
                for k in ("Results", "QualifyingResults", "SprintResults", "Laps", "PitStops"):
                    if k in race:
                        merged[key].setdefault(k, []).extend(race[k])
    return merged


def fetch_season_table(season, endpoint, key, expected_rounds, cache_dir):
    """Season-wide endpoint (results/qualifying/sprint). Cached copy is reused only if it
    already covers every round we expect to have data for."""
    races = races_from(fetch_all(f"{season}/{endpoint}", cache_dir))
    have = {r for r, race in races.items() if race.get(key)}
    if not expected_rounds <= have:
        races = races_from(fetch_all(f"{season}/{endpoint}", cache_dir, use_cache=False))
    return races


# ---------- value helpers ----------
def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def to_float(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def time_to_ms(t):
    """'1:12.983' / '72.983' / '1:35:23.504' -> milliseconds."""
    if not t:
        return None
    try:
        parts = t.split(":")
        secs = float(parts[-1])
        mins = int(parts[-2]) if len(parts) >= 2 else 0
        hrs = int(parts[-3]) if len(parts) >= 3 else 0
        return int(round((hrs * 3600 + mins * 60 + secs) * 1000))
    except ValueError:
        return None


def dt(session):
    if not session:
        return None
    return f"{session['date']}T{session.get('time', '')}".rstrip("T")


# ---------- upserts ----------
def upsert_circuit(db, c):
    loc = c.get("Location", {})
    db.execute("INSERT OR REPLACE INTO circuits VALUES (?,?,?,?,?,?,?)",
               (c["circuitId"], c["circuitName"], loc.get("locality"), loc.get("country"),
                to_float(loc.get("lat")), to_float(loc.get("long")), c.get("url")))


def upsert_driver(db, d):
    db.execute("INSERT OR REPLACE INTO drivers VALUES (?,?,?,?,?,?,?,?)",
               (d["driverId"], d.get("code"), to_int(d.get("permanentNumber")), d["givenName"],
                d["familyName"], d.get("dateOfBirth"), d.get("nationality"), d.get("url")))


def upsert_constructor(db, c):
    db.execute("INSERT OR REPLACE INTO constructors VALUES (?,?,?,?)",
               (c["constructorId"], c["name"], c.get("nationality"), c.get("url")))


def result_row(db, season, rnd, r):
    upsert_driver(db, r["Driver"])
    upsert_constructor(db, r["Constructor"])
    fl = r.get("FastestLap", {})
    fl_time = fl.get("Time", {}).get("time")
    return (season, rnd, r["Driver"]["driverId"], r["Constructor"]["constructorId"],
            to_int(r.get("number")), to_int(r.get("grid")), to_int(r.get("position")),
            r.get("positionText"), to_float(r.get("points")) or 0.0, to_int(r.get("laps")),
            r.get("status"), to_int(r.get("Time", {}).get("millis")), r.get("Time", {}).get("time"),
            to_int(fl.get("rank")), to_int(fl.get("lap")), fl_time, time_to_ms(fl_time))


def parse_seasons(spec: str):
    out = []
    for part in spec.split(","):
        if "-" in part:
            a, b = (int(x) for x in part.split("-"))
            out.extend(range(min(a, b), max(a, b) + 1))
        else:
            out.append(int(part))
    return sorted(set(out))


def scrape_season(db, season, details, refresh):
    cache_dir = ROOT / "data" / "raw" / str(season)
    today = datetime.now(timezone.utc).date().isoformat()

    print(f"\n=== Season {season} (details from {details}) ===")
    schedule = races_from(fetch_all(f"{season}/races", cache_dir, use_cache=not refresh))
    db.execute("INSERT OR REPLACE INTO seasons VALUES (?,?)",
               (season, f"https://en.wikipedia.org/wiki/{season}_Formula_One_World_Championship"))
    for rnd, race in schedule.items():
        upsert_circuit(db, race["Circuit"])
        sprint = race.get("Sprint")
        db.execute("""INSERT OR REPLACE INTO races
            (season, round, race_name, circuit_id, race_date, race_time_utc, fp1_datetime_utc,
             fp2_datetime_utc, fp3_datetime_utc, quali_datetime_utc, sprint_quali_datetime_utc,
             sprint_datetime_utc, is_sprint_weekend, is_completed, wiki_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)""",
                   (season, rnd, race["raceName"], race["Circuit"]["circuitId"],
                    race["date"], race.get("time"), dt(race.get("FirstPractice")),
                    dt(race.get("SecondPractice")), dt(race.get("ThirdPractice")),
                    dt(race.get("Qualifying")),
                    dt(race.get("SprintQualifying") or race.get("SprintShootout")),
                    dt(sprint), 1 if sprint else 0, race.get("url")))

    for p in fetch_all(f"{season}/drivers", cache_dir, use_cache=not refresh):
        for d in p["DriverTable"]["Drivers"]:
            upsert_driver(db, d)
    for p in fetch_all(f"{season}/constructors", cache_dir, use_cache=not refresh):
        for c in p["ConstructorTable"]["Constructors"]:
            upsert_constructor(db, c)

    past = {r for r, race in schedule.items() if race["date"] < today}
    past_sprints = {r for r in past if schedule[r].get("Sprint")}
    results = fetch_season_table(season, "results", "Results", past, cache_dir)
    quali = fetch_season_table(season, "qualifying", "QualifyingResults", past, cache_dir)
    sprints = fetch_season_table(season, "sprint", "SprintResults", past_sprints, cache_dir) \
        if past_sprints else {}

    for rnd in sorted(schedule):
        race = schedule[rnd]
        res = results.get(rnd, {}).get("Results")
        if not res:
            print(f"Round {rnd:2d} {race['raceName']}: no results yet ({race['date']})")
            continue
        print(f"Round {rnd:2d} {race['raceName']}")
        tables = ["race_results", "sprint_results", "qualifying_results"]
        if details == "api":
            tables += ["lap_times", "pit_stops", "driver_standings", "constructor_standings"]
        for tbl in tables:
            db.execute(f"DELETE FROM {tbl} WHERE season=? AND round=?", (season, rnd))

        db.executemany("INSERT INTO race_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       [result_row(db, season, rnd, r) for r in res])
        db.executemany("INSERT INTO sprint_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       [result_row(db, season, rnd, r)
                        for r in sprints.get(rnd, {}).get("SprintResults", [])])
        rows = []
        for r in quali.get(rnd, {}).get("QualifyingResults", []):
            upsert_driver(db, r["Driver"]); upsert_constructor(db, r["Constructor"])
            rows.append((season, rnd, r["Driver"]["driverId"], r["Constructor"]["constructorId"],
                         to_int(r.get("number")), to_int(r.get("position")),
                         r.get("Q1"), time_to_ms(r.get("Q1")), r.get("Q2"), time_to_ms(r.get("Q2")),
                         r.get("Q3"), time_to_ms(r.get("Q3"))))
        db.executemany("INSERT INTO qualifying_results VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", rows)

        if details == "api":
            scrape_round_details(db, season, rnd, cache_dir, refresh)
        db.execute("UPDATE races SET is_completed=1 WHERE season=? AND round=?", (season, rnd))
        db.commit()


def scrape_round_details(db, season, rnd, cache_dir, refresh):
    base = f"{season}/{rnd}"

    def get(ep):
        pages = fetch_all(f"{base}/{ep}", cache_dir)
        if refresh and int(pages[0]["total"]) == 0:
            pages = fetch_all(f"{base}/{ep}", cache_dir, use_cache=False)
        return races_from(pages).get(rnd, {})

    rows = [(season, rnd, t["driverId"], int(lap["number"]), to_int(t.get("position")),
             t.get("time"), time_to_ms(t.get("time")))
            for lap in get("laps").get("Laps", []) for t in lap["Timings"]]
    db.executemany("INSERT OR REPLACE INTO lap_times VALUES (?,?,?,?,?,?,?)", rows)

    rows = [(season, rnd, p["driverId"], int(p["stop"]), to_int(p.get("lap")), p.get("time"),
             p.get("duration"), time_to_ms(p.get("duration")))
            for p in get("pitstops").get("PitStops", [])]
    db.executemany("INSERT OR REPLACE INTO pit_stops VALUES (?,?,?,?,?,?,?,?)", rows)

    for p in fetch_all(f"{base}/driverstandings", cache_dir):
        for sl in p["StandingsTable"]["StandingsLists"]:
            for s in sl["DriverStandings"]:
                upsert_driver(db, s["Driver"])
                # API lists a driver's teams unordered; use the team of their latest race instead
                did = s["Driver"]["driverId"]
                team = db.execute("""SELECT constructor_id FROM race_results WHERE season=? AND driver_id=?
                                     AND round<=? ORDER BY round DESC LIMIT 1""", (season, did, rnd)).fetchone()
                cons = s.get("Constructors") or [{}]
                db.execute("INSERT OR REPLACE INTO driver_standings VALUES (?,?,?,?,?,?,?,?)",
                           (season, rnd, did, team[0] if team else cons[-1].get("constructorId"),
                            to_int(s.get("position")), s.get("positionText"),
                            to_float(s["points"]), to_int(s["wins"])))
    for p in fetch_all(f"{base}/constructorstandings", cache_dir):
        for sl in p["StandingsTable"]["StandingsLists"]:
            for s in sl["ConstructorStandings"]:
                upsert_constructor(db, s["Constructor"])
                db.execute("INSERT OR REPLACE INTO constructor_standings VALUES (?,?,?,?,?,?,?)",
                           (season, rnd, s["Constructor"]["constructorId"],
                            to_int(s.get("position")), s.get("positionText"),
                            to_float(s["points"]), to_int(s["wins"])))


def main():
    current = datetime.now(timezone.utc).year
    ap = argparse.ArgumentParser(description="Scrape F1 seasons into SQLite.")
    ap.add_argument("--season", default=str(current),
                    help="season, range or list: 2026 | 2015-2025 | 2019,2021")
    ap.add_argument("--db", default=str(ROOT / "data" / "f1.db"))
    ap.add_argument("--details", choices=["auto", "api", "dump"], default="auto",
                    help="source of laps/pit stops/standings (auto: dump for past seasons, api for current)")
    ap.add_argument("--refresh", action="store_true",
                    help="re-download schedule/entry lists and re-check rounds with missing data")
    ap.add_argument("--redownload-dump", action="store_true", help="fetch a fresh copy of the CSV dump")
    args = ap.parse_args()
    seasons = parse_seasons(args.season)

    Path(args.db).parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(args.db)
    db.executescript(SCHEMA.read_text())

    dump_seasons = []
    for season in seasons:
        details = args.details if args.details != "auto" else ("api" if season >= current else "dump")
        scrape_season(db, season, details, args.refresh)
        if details == "dump":
            dump_seasons.append(season)

    if dump_seasons:
        print(f"\nImporting laps / pit stops / standings from dump for {dump_seasons}")
        csv_dir = dump_import.ensure_dump(ROOT / "data" / "dump", args.redownload_dump)
        dump_import.import_details(db, csv_dir, dump_seasons)

    db.execute("INSERT INTO scrape_log VALUES (?,?,?,?)",
               (datetime.now(timezone.utc).isoformat(timespec="seconds"), seasons[0], API,
                f"seasons={args.season} details={args.details}"))
    db.commit()
    print("\nRow counts:")
    for (t,) in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
        print(f"  {t:24s} {db.execute(f'SELECT COUNT(*) FROM {t}').fetchone()[0]}")
    db.close()


if __name__ == "__main__":
    main()
