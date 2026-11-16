"""
Load lap times, pit stops and per-round standings from the Jolpica CSV database dump.

Fetching lap times through the API costs ~15 requests per race, which is far too slow for
past seasons under the API's rate limit (~500 requests/hour). The dump has the same data
in a single ~15 MB download. Results/qualifying/sprints still come from the API (scrape.py).

The dump is refreshed by Jolpica periodically, so use it for completed seasons only.
"""
import csv
import io
import shutil
import sys
import urllib.request
import zipfile
from collections import defaultdict
from pathlib import Path

DUMP_URL = "https://api.jolpi.ca/data/dumps/download/delayed/?dump_type=csv"
csv.field_size_limit(sys.maxsize)


def ensure_dump(dump_dir: Path, redownload: bool = False) -> Path:
    csv_dir = dump_dir / "csv"
    if csv_dir.exists() and not redownload:
        return csv_dir
    dump_dir.mkdir(parents=True, exist_ok=True)
    zpath = dump_dir / "jolpica-f1-csv.zip"
    print(f"Downloading database dump -> {zpath}")
    req = urllib.request.Request(DUMP_URL, headers={"User-Agent": "f1-stats-scraper/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r, open(zpath, "wb") as f:
        shutil.copyfileobj(r, f)
    if csv_dir.exists():
        shutil.rmtree(csv_dir)
    csv_dir.mkdir()
    with zipfile.ZipFile(zpath) as z:
        for name in z.namelist():
            base = Path(name).name          # flatten; never trust archive paths
            if base.endswith(".csv"):
                (csv_dir / base).write_bytes(z.read(name))
    return csv_dir


def rows(csv_dir: Path, table: str):
    with open(csv_dir / f"formula_one_{table}.csv", newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def interval_ms(t):
    """'00:01:16.29' -> 76290"""
    if not t:
        return None
    h, m, s = t.split(":")
    return int(round((int(h) * 3600 + int(m) * 60 + float(s)) * 1000))


def fmt_lap(ms):
    """76290 -> '1:16.290' (API lap-time format)"""
    if ms is None:
        return None
    m, rem = divmod(ms, 60000)
    return f"{m}:{rem / 1000:06.3f}"


def fmt_pit(ms):
    """24036 -> '24.036'; 1294123 -> '21:34.123' (API pit-duration format)"""
    if ms is None:
        return None
    return f"{ms / 1000:.3f}" if ms < 60000 else fmt_lap(ms)


def import_details(db, csv_dir: Path, seasons):
    seasons = {str(s) for s in seasons}
    season_year = {r["id"]: r["year"] for r in rows(csv_dir, "season") if r["year"] in seasons}
    rounds = {r["id"]: (int(season_year[r["season_id"]]), int(r["number"]))
              for r in rows(csv_dir, "round")
              if r["season_id"] in season_year and r["number"]}   # cancelled rounds have no number
    race_sessions = {r["id"]: rounds[r["round_id"]]
                     for r in rows(csv_dir, "session") if r["round_id"] in rounds and r["type"] == "R"}

    driver_ref = {r["id"]: r["reference"] for r in rows(csv_dir, "driver")}
    team_ref = {r["id"]: r["reference"] for r in rows(csv_dir, "team")}
    td_driver = {r["id"]: driver_ref[r["driver_id"]] for r in rows(csv_dir, "teamdriver")}
    re_driver = {r["id"]: td_driver[r["team_driver_id"]] for r in rows(csv_dir, "roundentry")}

    # session entry -> (season, round, driver_id) for race sessions only
    entries = {}
    for r in rows(csv_dir, "sessionentry"):
        if r["session_id"] in race_sessions:
            entries[r["id"]] = (*race_sessions[r["session_id"]], re_driver[r["round_entry_id"]])

    # only touch rounds that exist in our races table with results
    wanted = {tuple(x) for x in db.execute(
        f"SELECT season, round FROM races WHERE is_completed=1 AND season IN ({','.join('?' * len(seasons))})",
        sorted(int(s) for s in seasons))}

    # ---- lap times ----
    lap_rows, lap_number = [], {}
    for r in rows(csv_dir, "lap"):
        e = entries.get(r["session_entry_id"])
        if not e or not r["number"] or (e[0], e[1]) not in wanted:
            continue
        lap_number[r["id"]] = int(r["number"])
        ms = interval_ms(r["time"])
        lap_rows.append((*e, int(r["number"]), int(r["position"]) if r["position"] else None,
                         fmt_lap(ms), ms))

    # ---- pit stops ----
    pit_rows = []
    for r in rows(csv_dir, "pitstop"):
        e = entries.get(r["session_entry_id"])
        if not e or (e[0], e[1]) not in wanted:
            continue
        ms = interval_ms(r["duration"])
        pit_rows.append((*e, int(r["number"]), lap_number.get(r["lap_id"]), r["local_timestamp"] or None,
                         fmt_pit(ms), ms))

    # ---- standings: keep the snapshot taken after the last session of each round ----
    def latest_per_round(table):
        best = defaultdict(list)
        top = {}
        for r in rows(csv_dir, table):
            if r["year"] not in seasons:
                continue
            key = (int(r["year"]), int(r["round_number"]))
            if key not in wanted:
                continue
            n = int(r["session_number"])
            if n > top.get(key, -1):
                top[key], best[key] = n, [r]
            elif n == top[key]:
                best[key].append(r)
        return best

    ds_rows = []
    for (season, rnd), rs in latest_per_round("driverchampionship").items():
        for r in rs:
            did = driver_ref[r["driver_id"]]
            team = db.execute("""SELECT constructor_id FROM race_results WHERE season=? AND driver_id=?
                                 AND round<=? ORDER BY round DESC LIMIT 1""", (season, did, rnd)).fetchone()
            pos = int(r["position"]) if r["position"] else None
            ds_rows.append((season, rnd, did, team[0] if team else None, pos,
                            str(pos) if pos else "-", float(r["points"]), int(r["win_count"])))
    cs_rows = []
    for (season, rnd), rs in latest_per_round("teamchampionship").items():
        for r in rs:
            pos = int(r["position"]) if r["position"] else None
            cs_rows.append((season, rnd, team_ref[r["team_id"]], pos, str(pos) if pos else "-",
                            float(r["points"]), int(r["win_count"])))

    for season, rnd in wanted:
        for tbl in ("lap_times", "pit_stops", "driver_standings", "constructor_standings"):
            db.execute(f"DELETE FROM {tbl} WHERE season=? AND round=?", (season, rnd))
    db.executemany("INSERT OR REPLACE INTO lap_times VALUES (?,?,?,?,?,?,?)", lap_rows)
    db.executemany("INSERT OR REPLACE INTO pit_stops VALUES (?,?,?,?,?,?,?,?)", pit_rows)
    db.executemany("INSERT OR REPLACE INTO driver_standings VALUES (?,?,?,?,?,?,?,?)", ds_rows)
    db.executemany("INSERT OR REPLACE INTO constructor_standings VALUES (?,?,?,?,?,?,?)", cs_rows)
    db.commit()

    got = {(s, r) for s, r, *_ in lap_rows}
    missing = sorted(wanted - got)
    print(f"  dump: {len(lap_rows)} laps, {len(pit_rows)} pit stops, "
          f"{len(ds_rows)} driver + {len(cs_rows)} constructor standings rows")
    if missing:
        print(f"  dump has no lap data for: {missing}")
