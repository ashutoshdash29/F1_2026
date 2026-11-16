#!/usr/bin/env python3
"""
Export the data the frontend needs from data/f1.db:
    frontend/public/data/seasons/<year>.json   one file per season (standings, calendar, history)
    frontend/public/data/seasons/index.json    season list + champions, for the season picker
    frontend/public/data/standings.json        copy of the latest season (backwards compatible)

Safe to run while the scraper is still writing: the DB is opened read-only and each season's
"latest round" is whatever round has a full set of standings right now.

Usage:
    python3 frontend/scripts/export_data.py             # every season in the DB
    python3 frontend/scripts/export_data.py --season 2026
"""
import argparse
import json
import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "f1.db"
DATA = ROOT / "frontend" / "public" / "data"


def rows(db, sql, *args):
    return [dict(r) for r in db.execute(sql, args)]


def build_season(db, season):
    std_rounds = [r["round"] for r in rows(
        db, "SELECT DISTINCT round FROM driver_standings WHERE season=? ORDER BY round", season)]
    if not std_rounds:
        return None
    latest = std_rounds[-1]
    prev = std_rounds[-2] if len(std_rounds) > 1 else None

    # ---------- calendar ----------
    races = rows(db, """
        SELECT ra.round, ra.race_name, ra.race_date, ra.race_time_utc, ra.is_sprint_weekend,
               ci.circuit_id, ci.name AS circuit, ci.locality, ci.country,
               EXISTS(SELECT 1 FROM race_results rr
                       WHERE rr.season=ra.season AND rr.round=ra.round) AS has_results
        FROM races ra JOIN circuits ci USING (circuit_id)
        WHERE ra.season=? ORDER BY ra.round""", season)
    winners = {r["round"]: r for r in rows(db, """
        SELECT rr.round, rr.driver_id, d.code, d.given_name, d.family_name, rr.constructor_id
        FROM race_results rr JOIN drivers d USING (driver_id)
        WHERE rr.season=? AND rr.position=1""", season)}
    poles = {r["round"]: r for r in rows(db, """
        SELECT q.round, q.driver_id, d.code, d.given_name, d.family_name
        FROM qualifying_results q JOIN drivers d USING (driver_id)
        WHERE q.season=? AND q.position=1""", season)}

    today = date.today().isoformat()
    cal = []
    for r in races:
        w = winners.get(r["round"])
        cal.append({
            "round": r["round"], "name": r["race_name"], "date": r["race_date"],
            "timeUtc": r["race_time_utc"], "circuitId": r["circuit_id"], "circuit": r["circuit"],
            "locality": r["locality"], "country": r["country"],
            "sprint": bool(r["is_sprint_weekend"]), "completed": bool(r["has_results"]),
            "winner": ({"id": w["driver_id"], "code": w["code"],
                        "name": f'{w["given_name"]} {w["family_name"]}', "teamId": w["constructor_id"]}
                       if w else None),
        })

    last = next((c for c in reversed(cal) if c["round"] == latest), None)
    if last:
        p = poles.get(latest)
        last = dict(last, pole=({"id": p["driver_id"], "code": p["code"],
                                 "name": f'{p["given_name"]} {p["family_name"]}'} if p else None))
    nxt = next((c for c in cal if c["date"] >= today), None)

    # ---------- per-driver extras ----------
    stats = {r["driver_id"]: r for r in rows(
        db, "SELECT * FROM v_driver_season_stats WHERE season=?", season)}
    pole_counts = {r["driver_id"]: r["n"] for r in rows(db, """
        SELECT driver_id, COUNT(*) n FROM qualifying_results
        WHERE season=? AND position=1 GROUP BY driver_id""", season)}

    def history(table, key):
        h = {}
        for r in rows(db, f"SELECT {key} AS k, round, points FROM {table} WHERE season=? ORDER BY round", season):
            h.setdefault(r["k"], {})[r["round"]] = r["points"]
        # dense list over every standings round (0 before first appearance)
        return {k: [v.get(rd, 0) for rd in std_rounds] for k, v in h.items()}

    d_hist = history("driver_standings", "driver_id")

    # Grand Prix finishing result per standings round: '1'..'20', 'R' retired, 'D' DSQ, ... ; None = did not take part
    fin = {}
    for r in rows(db, "SELECT driver_id, round, position, position_text FROM race_results WHERE season=?", season):
        fin.setdefault(r["driver_id"], {})[r["round"]] = r["position_text"] or (str(r["position"]) if r["position"] else None)
    c_hist = history("constructor_standings", "constructor_id")

    prev_d = {r["driver_id"]: r for r in rows(
        db, "SELECT * FROM driver_standings WHERE season=? AND round=?", season, prev)} if prev else {}
    prev_c = {r["constructor_id"]: r for r in rows(
        db, "SELECT * FROM constructor_standings WHERE season=? AND round=?", season, prev)} if prev else {}

    drivers = []
    for r in rows(db, """
        SELECT ds.*, d.code, d.permanent_number, d.given_name, d.family_name, d.nationality,
               d.date_of_birth
        FROM driver_standings ds JOIN drivers d USING (driver_id)
        WHERE ds.season=? AND ds.round=? ORDER BY ds.position IS NULL, ds.position, ds.points DESC""", season, latest):
        s = stats.get(r["driver_id"], {})
        p = prev_d.get(r["driver_id"])
        drivers.append({
            "id": r["driver_id"], "code": r["code"], "number": r["permanent_number"],
            "first": r["given_name"], "last": r["family_name"], "nationality": r["nationality"],
            "dob": r["date_of_birth"], "teamId": r["constructor_id"],
            "pos": r["position"], "prevPos": p["position"] if p else None,
            "points": r["points"], "prevPoints": p["points"] if p else None, "wins": r["wins"],
            "podiums": s.get("podiums") or 0, "poles": pole_counts.get(r["driver_id"], 0),
            "fastestLaps": s.get("fastest_laps") or 0, "dnfs": s.get("dnfs") or 0,
            "starts": s.get("starts") or 0, "avgFinish": s.get("avg_finish"),
            "history": d_hist.get(r["driver_id"], []),
            "finishes": [fin.get(r["driver_id"], {}).get(rd) for rd in std_rounds],
        })

    cstats = {r["constructor_id"]: r for r in rows(
        db, "SELECT * FROM v_constructor_season_stats WHERE season=?", season)}
    constructors = []
    for r in rows(db, """
        SELECT cs.*, c.name, c.nationality FROM constructor_standings cs
        JOIN constructors c USING (constructor_id)
        WHERE cs.season=? AND cs.round=? ORDER BY cs.position IS NULL, cs.position, cs.points DESC""", season, latest):
        p = prev_c.get(r["constructor_id"])
        s = cstats.get(r["constructor_id"], {})
        constructors.append({
            "id": r["constructor_id"], "name": r["name"], "nationality": r["nationality"],
            "pos": r["position"], "prevPos": p["position"] if p else None,
            "points": r["points"], "prevPoints": p["points"] if p else None, "wins": r["wins"],
            "podiums": s.get("podiums") or 0, "dnfs": s.get("dnfs") or 0,
            "drivers": [d["id"] for d in drivers if d["teamId"] == r["constructor_id"]],
            "history": c_hist.get(r["constructor_id"], []),
        })

    out = {
        "season": season,
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "round": latest, "rounds": std_rounds, "totalRounds": len(cal),
        "lastRace": last, "nextRace": nxt, "calendar": cal,
        "drivers": drivers, "constructors": constructors,
    }
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, help="only this season (default: all)")
    a = ap.parse_args()

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=15)
    db.row_factory = sqlite3.Row
    seasons = [a.season] if a.season else [r["season"] for r in rows(
        db, "SELECT DISTINCT season FROM driver_standings ORDER BY season")]

    out_dir = DATA / "seasons"
    out_dir.mkdir(parents=True, exist_ok=True)
    index_file = out_dir / "index.json"
    index = {s["season"]: s for s in json.loads(index_file.read_text())["seasons"]} if index_file.exists() else {}
    for season in seasons:
        out = build_season(db, season)
        if not out:
            print(f"{season}: no standings yet, skipped")
            continue
        (out_dir / f"{season}.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
        d, c = out["drivers"][0], out["constructors"][0]
        complete = out["round"] >= out["totalRounds"]
        index[season] = {
            "season": season, "round": out["round"], "totalRounds": out["totalRounds"], "complete": complete,
            "driver": {"id": d["id"], "code": d["code"], "name": f'{d["first"]} {d["last"]}', "teamId": d["teamId"],
                       "points": d["points"], "wins": d["wins"]},
            "constructor": {"id": c["id"], "name": c["name"], "points": c["points"]},
        }
        print(f"{season}: round {out['round']}/{out['totalRounds']}, {len(out['drivers'])} drivers, "
              f"leader {d['code']}{' (champion)' if complete else ''}")

    latest = max(index)
    index_file.write_text(json.dumps({"current": latest, "seasons": [index[k] for k in sorted(index)]},
                                     ensure_ascii=False, indent=1))
    (DATA / "standings.json").write_text((out_dir / f"{latest}.json").read_text())
    print(f"wrote {out_dir.relative_to(ROOT)}/ ({len(index)} seasons, current {latest})")


if __name__ == "__main__":
    main()
