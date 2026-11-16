#!/usr/bin/env python3
"""
Pick each season's "Moments": the races that made the news, with a headline and a photo.

Stories come from the data (so captions are always true to the DB):
  * the round the title was sealed (or "went down to the wire")
  * first-ever Grand Prix wins
  * wins from P10 or lower on the grid
  * the season opener
A few famous moments get a hand-written headline (HEADLINES below).
Photos: the race's Wikimedia Commons category ("<year> <Grand Prix>"), preferring files that
name the winner or show a start / podium.

Writes the "moments" list into scripts/media_sources.json (hand-edit it freely afterwards);
`python3 scripts/fetch_media.py` then downloads the photos.

Usage: python3 frontend/scripts/build_moments.py [--per-season 6] [--season 2021]
"""
import argparse
import json
import re
import sqlite3
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DB = ROOT / "data" / "f1.db"
SOURCES = Path(__file__).with_name("media_sources.json")
UA = "f1-stats-frontend/0.1 (personal, non-commercial project)"
API = "https://commons.wikimedia.org/w/api.php"

# drivers who already had Grand Prix wins before 2015 (the DB starts in 2015)
WON_BEFORE_2015 = {"hamilton", "rosberg", "vettel", "raikkonen", "alonso", "button", "massa",
                   "ricciardo", "maldonado", "kubica", "webber"}
# famous moments: (season, round) -> headline. Only well-documented facts.
HEADLINES = {
    (2016, 5): "Verstappen wins on his Red Bull debut, aged 18",
    (2020, 15): "Grosjean walks away from a fiery first-lap crash",
    (2020, 16): "Pérez fights back from last place on lap one to take his first win",
    (2021, 22): "Last-lap showdown: Verstappen passes Hamilton to win his first title",
}

_last = 0.0


def api(**params):
    global _last
    params = {"action": "query", "format": "json", **params}
    for attempt in range(6):
        wait = 1.2 - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code != 429:
                raise
            time.sleep(10 * (attempt + 1))
    return {}


def stories(db, season):
    races = {r[0]: {"round": r[0], "name": r[1], "locality": r[2]} for r in db.execute(
        "SELECT ra.round, ra.race_name, ci.locality FROM races ra JOIN circuits ci USING (circuit_id) "
        "WHERE ra.season=? ORDER BY ra.round", (season,))}
    winners = {r[0]: {"id": r[1], "name": f"{r[2]} {r[3]}", "last": r[3], "grid": r[4]} for r in db.execute(
        "SELECT rr.round, rr.driver_id, d.given_name, d.family_name, rr.grid FROM race_results rr "
        "JOIN drivers d USING (driver_id) WHERE rr.season=? AND rr.position=1", (season,))}
    out = {}

    def add(rnd, kind, caption, prio):
        if rnd in races and rnd in winners and (rnd not in out or out[rnd]["prio"] < prio):
            out[rnd] = {"round": rnd, "kind": kind, "caption": caption, "prio": prio}

    # title sealed: first round after which the leader can no longer be caught
    rounds = [r[0] for r in db.execute("SELECT DISTINCT round FROM driver_standings WHERE season=? ORDER BY round", (season,))]
    total = len(races)
    if rounds and rounds[-1] == total:
        sprint = {r[0] for r in db.execute("SELECT DISTINCT round FROM sprint_results WHERE season=?", (season,))}
        fl = 1 if 2019 <= season <= 2024 else 0
        for rnd in rounds:
            top = db.execute("SELECT driver_id, points FROM driver_standings WHERE season=? AND round=? "
                             "ORDER BY position IS NULL, position LIMIT 2", (season, rnd)).fetchall()
            left = sum(25 + fl + (8 if r in sprint else 0) for r in races if r > rnd)
            if len(top) == 2 and top[0][1] - top[1][1] > left:
                name = " ".join(db.execute("SELECT given_name, family_name FROM drivers WHERE driver_id=?", (top[0][0],)).fetchone())
                where = races[rnd]["name"]
                cap = (f"Title goes down to the wire: {name} crowned at the {where}" if rnd == total
                       else f"{name} seals the {season} title at the {where}")
                add(rnd, "title", cap, 100)
                break

    # first-ever wins (only for drivers whose whole career is inside the DB)
    first_race = {r[0]: (r[1], r[2]) for r in db.execute(
        "SELECT driver_id, MIN(season*100+round)/100, MIN(season*100+round)%100 FROM race_results GROUP BY driver_id")}
    for rnd, w in winners.items():
        earlier = db.execute("SELECT COUNT(*) FROM race_results WHERE driver_id=? AND position=1 AND "
                             "(season<? OR (season=? AND round<?))", (w["id"], season, season, rnd)).fetchone()[0]
        debut_in_db = first_race.get(w["id"], (2015, 1)) != (2015, 1)
        if not earlier and debut_in_db and w["id"] not in WON_BEFORE_2015:
            add(rnd, "maiden", f"{w['name']} takes a first Grand Prix win in {races[rnd]['locality']}", 80)
    # comeback wins
    for rnd, w in winners.items():
        if w["grid"] and w["grid"] >= 10:
            add(rnd, "comeback", f"{w['name']} wins the {races[rnd]['name']} from P{w['grid']} on the grid", 60)
    # opener
    if 1 in winners:
        add(1, "opener", f"{winners[1]['name']} wins the season opener in {races[1]['locality']}", 40)
    # hand-written headlines win over generated ones
    for (yr, rnd), text in HEADLINES.items():
        if yr == season:
            add(rnd, "headline", text, 200)
    # fill with the champion's / leader's wins so every season has enough
    lead = db.execute("SELECT driver_id FROM driver_standings WHERE season=? AND round=? "
                      "ORDER BY position IS NULL, position LIMIT 1", (season, rounds[-1] if rounds else 0)).fetchone()
    for rnd, w in sorted(winners.items()):
        if lead and w["id"] == lead[0]:
            add(rnd, "win", f"{w['name']} wins the {races[rnd]['name']}", 10)
    for v in out.values():
        v["race"] = races[v["round"]]["name"]
        v["winner"] = winners[v["round"]]
    return sorted(out.values(), key=lambda v: (-v["prio"], v["round"]))


TEAM_WORDS = ["mercedes", "ferrari", "red bull", "redbull", "mclaren", "williams", "alpine", "renault", "haas",
              "sauber", "alfa romeo", "alphatauri", "alpha tauri", "toro rosso", "racing point", "force india",
              "aston martin", "lotus", "manor", "racing bulls", "audi", "cadillac"]
SCENE_WORDS = r"podium|start|winner|victory|celebrat|champion|first lap|lap 1|race day|grid"
BAD_WORDS = r"qualifying|\bfp[123]\b|practice|pit lane walk|garage|logo|map|ticket|helmet|livery|airways|aircraft|restaurant|barrier|historic|parade|1970|demo"


def score_file(title, w, h, winner_last, names):
    """Relevance score for a Commons photo, or None if it is not usable at all."""
    low = title.lower()
    if w < 1600 or w < 1.25 * h or not low.endswith((".jpg", ".jpeg")):
        return None
    if re.search(BAD_WORDS, low):
        return None
    relevant = (any(n in low for n in names) or any(t in low for t in TEAM_WORDS)
                or re.search(SCENE_WORDS, low))
    if not relevant:
        return None
    sc = 5 if winner_last in low else 0
    sc += 2 if re.search(SCENE_WORDS, low) else 0
    return sc + min(w, 6000) / 6000


def photo_for(season, race_name, winner_last, names, used):
    """Best photo from the race's Commons category; fallback: a photo of the winner that season."""
    winner_last = winner_last.lower()
    best, best_score = None, -1.0
    d = api(generator="categorymembers", gcmtitle=f"Category:{season} {race_name}", gcmtype="file",
            gcmlimit=200, prop="imageinfo", iiprop="url|size|mime")
    for p in (d.get("query") or {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        if p["title"] in used:
            continue
        sc = score_file(p["title"], ii.get("width", 0), ii.get("height", 0), winner_last, names)
        if sc is not None and sc > best_score:
            best, best_score = p["title"], sc
    if best:
        return best, "race"
    # fallback: the winner (by name) in that season, from anywhere on Commons
    d = api(generator="search", gsrsearch=f'intitle:"{winner_last}" {season} filetype:bitmap', gsrnamespace=6,
            gsrlimit=30, prop="imageinfo", iiprop="url|size|mime")
    for p in (d.get("query") or {}).get("pages", {}).values():
        ii = (p.get("imageinfo") or [{}])[0]
        t = p["title"]
        low = t.lower()
        f1_context = re.search(r"grand prix|\bgp\b|\bf1\b|formula|" + "|".join(TEAM_WORDS), low)
        # the surname alone is ambiguous (Hamilton Park, Norris Geyser Basin...): demand an F1 context
        if t in used or str(season) not in t or winner_last not in low or not f1_context:
            continue
        sc = score_file(t, ii.get("width", 0), ii.get("height", 0), winner_last, names)
        if sc is not None and sc > best_score:
            best, best_score = t, sc
    return (best, "season") if best else (None, None)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--per-season", type=int, default=6)
    ap.add_argument("--season", type=int)
    a = ap.parse_args()
    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=15)
    seasons = [a.season] if a.season else [r[0] for r in db.execute(
        "SELECT DISTINCT season FROM race_results ORDER BY season")]

    src = json.loads(SOURCES.read_text())
    keep = [m for m in src.get("moments", []) if m["season"] not in seasons]
    for season in seasons:
        used, picked = set(), []
        for st in stories(db, season):
            if len(picked) >= a.per_season:
                break
            names = {re.sub(r"[^a-z ]", "", r[0].lower()) for r in db.execute(
                "SELECT d.family_name FROM race_results rr JOIN drivers d USING (driver_id) "
                "WHERE rr.season=? AND rr.round=? AND rr.position<=10", (season, st["round"]))}
            f, origin = photo_for(season, st["race"], st["winner"]["last"], names, used)
            if not f:
                continue
            used.add(f)
            picked.append({"id": f"m{season}-{st['round']:02d}", "season": season, "round": st["round"],
                           "kind": st["kind"], "file": f, "caption": st["caption"],
                           "place": f"Round {st['round']} · {st['race'].replace('Grand Prix', 'GP')}",
                           "focus": "50% 55%", "photo": origin})
        picked.sort(key=lambda m: m["round"])
        keep += picked
        print(f"{season}: {len(picked)} moments " + ", ".join(f"R{m['round']}:{m['kind']}" for m in picked))
    src["moments"] = sorted(keep, key=lambda m: (m["season"], m["round"]))
    SOURCES.write_text(json.dumps(src, ensure_ascii=False, indent=2))
    print(f"wrote {len(src['moments'])} moments to {SOURCES.name}")


if __name__ == "__main__":
    main()
