#!/usr/bin/env python3
"""
Download the official formula1.com driver photos (transparent full-body cutouts) and turn them into
    public/media/overrides/drivers/<driver_id>.webp       bust crop (head to chest)  -> tables
    public/media/overrides/drivers_half/<driver_id>.webp  half-body crop             -> podium cards
Overrides always win over the Wikimedia portraits, so rerun `python3 scripts/fetch_media.py`
afterwards (`npm run headshots` does both).

These images are (c) Formula One World Championship Ltd. They are fetched for a personal,
local project; do not publish them without the rights to do so.

Needs ImageMagick (`magick`).
Covers every driver in any season's standings. Sources, in order:
  1. this season's grid page (full-body cutouts)
  2. the previous two seasons' cutouts (same URL scheme, different team slugs)
  3. the legacy formula1.com head-and-shoulders cutouts (most drivers from ~2016 on)
Drivers found nowhere: if `rembg` is importable (pip install "rembg[cpu]", ideally in a venv), their
Wikimedia portrait (from fetch_media.py) is cut out and cropped the same way; otherwise they keep
the plain portrait.

Usage: python3 frontend/scripts/fetch_headshots.py [--season 2026] [--force]
"""
import argparse
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PUB = ROOT / "frontend" / "public"
OUT = PUB / "media" / "overrides" / "drivers"
OUT_HALF = PUB / "media" / "overrides" / "drivers_half"
OUT_SEASON = PUB / "media" / "overrides" / "drivers_season"  # <year>/<driver_id>.webp, era-correct kit
SEASON_SLUGS = {2024: {"rb": "rb", "sauber": "kicksauber"}, 2025: {"rb": "racingbulls", "sauber": "kicksauber"}}
DB = ROOT / "data" / "f1.db"
MAGICK = shutil.which("magick")
UA = "Mozilla/5.0 (personal F1 stats project)"
IMG = "https://media.formula1.com/image/upload/c_lfill,w_1000/q_auto/v1740000001/common/f1/{season}/{team}/{code}/{season}{team}{code}right.webp"
LEGACY = "https://media.formula1.com/content/dam/fom-website/drivers/{L}/{CODE}_{first}_{last}/{code}.png"
OLD_SLUGS = ["rb", "kicksauber", "racingbulls", "haasf1team", "alpine", "williams", "astonmartin", "mclaren",
             "mercedes", "ferrari", "redbullracing"]
# our constructor ids -> formula1.com team slugs (used when guessing last season's photo)
SLUGS = {"mercedes": "mercedes", "ferrari": "ferrari", "mclaren": "mclaren", "red_bull": "redbullracing",
         "rb": "racingbulls", "alpine": "alpine", "haas": "haasf1team", "audi": "audi", "sauber": "kicksauber",
         "williams": "williams", "aston_martin": "astonmartin", "cadillac": "cadillac"}
BUST, HALF = 0.33, 0.60  # fraction of the trimmed body height kept for each crop


def fetch(url, binary=True):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=40) as r:
                return r.read() if binary else r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code in (404, 400):
                return None
            time.sleep(3 * (attempt + 1))
        except urllib.error.URLError:
            time.sleep(3 * (attempt + 1))
    return None


def ascii_letters(s):
    return re.sub(r"[^a-z]", "", unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower())


# formula1.com codes that don't follow the usual pattern
CODE_FIXES = {"mick_schumacher": "micsch02", "latifi": "niclaf01"}


def f1_code(first, last):
    # first word of the given name + whole family name ("de Vries" -> "dev")
    return f"{ascii_letters(first.split()[0])[:3]}{ascii_letters(last)[:3]}01"


def legacy_urls(first, last, code):
    q = urllib.parse.quote
    fam = [last, " ".join(w[:1].upper() + w[1:] for w in last.split())]
    for f in dict.fromkeys([first.split()[0], first.replace(" ", "_")]):
        for l in dict.fromkeys(fam):
            yield LEGACY.format(L=first[0].upper(), CODE=code.upper(), first=q(f), last=q(l), code=code)


# better source photos (Wikimedia Commons) than the driver's Wikipedia lead image, for the cutout fallback
PORTRAIT_FILES = {"rosberg": "File:Nico Rosberg 2016 Malaysia 1.jpg",
                  "merhi": "File:Roberto Merhi 2015 Malaysia.jpg"}


def commons_file(title):
    q = urllib.parse.urlencode({"action": "query", "format": "json", "titles": title, "prop": "imageinfo",
                                "iiprop": "url|extmetadata", "iiurlwidth": 1000})
    page = next(iter(json.loads(fetch("https://commons.wikimedia.org/w/api.php?" + q, binary=False))["query"]["pages"].values()))
    ii = page["imageinfo"][0]
    m = ii.get("extmetadata", {})
    clean = lambda v: re.sub(r"<[^>]+>", "", v or "").strip() or None
    credit = {"title": title.removeprefix("File:"), "author": clean(m.get("Artist", {}).get("value")),
              "license": clean(m.get("LicenseShortName", {}).get("value")), "url": ii.get("descriptionurl")}
    return fetch(ii["thumburl"]), credit


def cutout_from_portrait(did, credits):
    """Background-remove a Wikimedia portrait so retired drivers match the official cutouts."""
    try:
        from rembg import remove  # optional dependency
    except ImportError:
        return False
    wiki = None
    if did in PORTRAIT_FILES:
        data, wiki = commons_file(PORTRAIT_FILES[did])
    else:
        src = next((p for p in (PUB / "media" / "drivers").glob(f"{did}.*")), None)
        data = src.read_bytes() if src else None
    if not data:
        return False
    bust, half = OUT / f"{did}.webp", OUT_HALF / f"{did}.webp"
    cut = OUT / f"{did}.cut.png"
    cut.write_bytes(remove(data))
    magick(cut, "-trim", "+repage", cut)
    w, h = map(int, subprocess.run([MAGICK, "identify", "-format", "%w %h", cut],
                                   capture_output=True, text=True, check=True).stdout.split())
    # keep head-to-chest: at most 1.28x as tall as wide (same framing as the official busts)
    crop = ["-crop", f"{w}x{min(h, round(w * 1.28))}+0+0", "+repage"]
    magick(cut, *crop, "-resize", "520x>", "-quality", "88", bust)
    magick(cut, *crop, "-resize", "720x>", "-quality", "88", half)
    cut.unlink()
    manifest = PUB / "media" / "manifest.json"
    if wiki is None and manifest.exists():
        wiki = json.loads(manifest.read_text())["drivers"].get(did, {}).get("credit")
    credits[did] = dict(wiki or {"title": "Wikimedia portrait"}, title=((wiki or {}).get("title") or "Portrait") + " (background removed)")
    return True


def make_crops(data, did, bust, half=None):
    """Official cutout -> bust (head to chest) [+ half-body] .webp files."""
    bust.parent.mkdir(parents=True, exist_ok=True)
    raw = bust.with_name(f"{did}.src")
    raw.write_bytes(data)
    trimmed = bust.with_name(f"{did}.trim.png")
    magick(raw, "-trim", "+repage", trimmed)
    w, h = map(int, subprocess.run([MAGICK, "identify", "-format", "%w %h", trimmed],
                                   capture_output=True, text=True, check=True).stdout.split())
    # full-body cutouts are ~4x taller than wide; older/stand-in photos are already head-and-shoulders
    full_body = h > 2 * w
    for dest, frac, size in ((bust, BUST, "520x>"), (half, HALF, "720x>")):
        if dest is None:
            continue
        crop = ["-crop", f"{w}x{round(h * frac)}+0+0", "+repage"] if full_body else []
        # trim again: some cutouts sit in a wider canvas than the person, leaving empty sides
        magick(trimmed, *crop, "-trim", "+repage", "-resize", size, "-quality", "88", dest)
    raw.unlink()
    trimmed.unlink()


SEASON_PORTRAITS = {  # (season, driver) -> Commons file, checked by eye: right person, right kit
    (2015, "merhi"): "File:Roberto Merhi 2015 Malaysia.jpg",
    (2015, "stevens"): "File:Will Stevens 2015 Malaysia.jpg",
    (2016, "haryanto"): "File:Rio Haryanto 2016 paddock.jpg",
    (2016, "jolyon_palmer"): "File:Palmer April 2016.jpg",
    (2016, "kevin_magnussen"): "File:Kevin Magnussen April 2016.jpg",
    (2016, "ocon"): "File:Esteban Ocon 2016 Malaysia.jpg",
    (2017, "ocon"): "File:Esteban Ocon 2017 Malaysia 1.jpg",
    (2017, "stroll"): "File:Lance Stroll 2017 Malaysia 3.jpg",
    (2017, "vandoorne"): "File:Stoffel Vandoorne - Malaysia GP 2017.jpg",
    (2018, "leclerc"): "File:Charles Leclerc Silverstone 2018.jpg",
    (2018, "sirotkin"): "File:Sergey Sirotkin Moscow asv2018-01.jpg",
}
YEAR_URL ="https://media.formula1.com/content/dam/fom-website/drivers/{yr}Drivers/{slug}.png"
BUST_OF_PORTRAIT = 0.46  # studio portraits run head to thigh; keep head to chest


def season_photos_older(db, a):
    """Era-correct kit for older seasons.

    formula1.com still serves each season's studio portrait at /{year}Drivers/{surname}.png for
    2015 and 2019-2023 (opaque background -> cut out with rembg). Seasons with no photo of their
    own (2016-2018, or a driver missing that year) borrow the nearest season in which the driver
    raced for the *same team*, so the kit still matches. Without rembg only the gap-filling runs.
    """
    try:
        from rembg import remove
    except ImportError:
        remove = None
        print("   (rembg not installed: skipping official per-year portraits, only filling gaps)")

    seasons = [r[0] for r in db.execute("SELECT DISTINCT season FROM driver_standings ORDER BY season")]
    team_of = {}  # (driver, season) -> constructor (team at the season's final round)
    for yr in seasons:
        for did, first, last, team_id in db.execute("""
                SELECT d.driver_id, d.given_name, d.family_name, s.constructor_id
                FROM driver_standings s JOIN drivers d USING (driver_id)
                WHERE s.season=? AND s.round=(SELECT MAX(round) FROM driver_standings WHERE season=?)""", (yr, yr)):
            team_of[(did, yr)] = team_id
            dest = OUT_SEASON / str(yr) / f"{did}.webp"
            if yr >= a.season or dest.exists() and not a.force or remove is None:
                continue
            for slug in dict.fromkeys([ascii_letters(last), ascii_letters(last.split()[-1])]):
                data = fetch(YEAR_URL.format(yr=yr, slug=slug))
                if not data:
                    continue
                dest.parent.mkdir(parents=True, exist_ok=True)
                cut = dest.with_suffix(".cut.png")
                cut.write_bytes(remove(data))
                magick(cut, "-trim", "+repage", cut)
                w, h = map(int, subprocess.run([MAGICK, "identify", "-format", "%w %h", cut],
                                               capture_output=True, text=True, check=True).stdout.split())
                crop = ["-crop", f"{w}x{round(h * BUST_OF_PORTRAIT)}+0+0", "+repage"] if h > 1.3 * w else []
                magick(cut, *crop, "-trim", "+repage", "-resize", "520x>", "-quality", "88", dest)
                cut.unlink()
                print(f"   {yr} {did}: official portrait")
                break

    # hand-checked Commons photos of drivers in that season's kit, for seasons F1 has no portrait of
    if remove is not None:
        for (yr, did), title in SEASON_PORTRAITS.items():
            dest = OUT_SEASON / str(yr) / f"{did}.webp"
            if dest.exists() and not a.force:
                continue
            data, _credit = commons_file(title)
            if not data:
                continue
            dest.parent.mkdir(parents=True, exist_ok=True)
            cut = dest.with_suffix(".cut.png")
            cut.write_bytes(remove(data))
            magick(cut, "-trim", "+repage", cut)
            w, h = map(int, subprocess.run([MAGICK, "identify", "-format", "%w %h", cut],
                                           capture_output=True, text=True, check=True).stdout.split())
            magick(cut, "-crop", f"{w}x{min(h, round(w * 1.28))}+0+0", "+repage", "-trim", "+repage",
                   "-resize", "520x>", "-quality", "88", dest)
            cut.unlink()
            print(f"   {yr} {did}: Commons portrait")

    # fill gaps from the nearest season with the same team (only from real photos, never from fills)
    real = {(int(p.parent.name), p.stem) for p in OUT_SEASON.glob("*/*.webp")}
    filled = 0
    for (did, yr), team_id in team_of.items():
        if yr >= a.season or (yr, did) in real:
            continue
        options = sorted((abs(y - yr), y) for (d, y), t in team_of.items()
                         if d == did and t == team_id and (y, did) in real and y != yr)
        if options:
            dest = OUT_SEASON / str(yr) / f"{did}.webp"
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(OUT_SEASON / str(options[0][1]) / f"{did}.webp", dest)
            filled += 1
    print(f"   filled {filled} driver-seasons from the nearest season with the same team")


def magick(*args):
    subprocess.run([MAGICK, *map(str, args)], check=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    if not MAGICK:
        sys.exit("ImageMagick (`magick`) is required")

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=15)
    # every driver in any season, with their most recent season + team
    drivers = db.execute("""
        SELECT d.driver_id, d.given_name, d.family_name, s.constructor_id, s.season
        FROM driver_standings s JOIN drivers d USING (driver_id)
        WHERE (s.season, s.round) = (SELECT season, round FROM driver_standings x
                                     WHERE x.driver_id = s.driver_id ORDER BY season DESC, round DESC LIMIT 1)
        ORDER BY s.season DESC""").fetchall()

    page = fetch("https://www.formula1.com/en/drivers", binary=False) or ""
    grid = {code: team for team, code in re.findall(
        rf"common/f1/{a.season}/([a-z0-9]+)/([a-z0-9]+)/{a.season}\1\2right\.webp", page)}
    print(f"{len(grid)} drivers on the current formula1.com grid page")

    OUT.mkdir(parents=True, exist_ok=True)
    OUT_HALF.mkdir(parents=True, exist_ok=True)
    credits, missing = {}, []
    old_credits = json.loads((OUT / "credits.json").read_text()) if (OUT / "credits.json").exists() else {}
    for did, first, last, team_id, last_season in drivers:
        bust, half = OUT / f"{did}.webp", OUT_HALF / f"{did}.webp"
        code = CODE_FIXES.get(did) or f1_code(first, last)
        if bust.exists() and half.exists() and not a.force:
            credits[did] = old_credits.get(did, "Formula 1")
            continue
        data = None
        if code in grid:
            data = fetch(IMG.format(season=a.season, team=grid[code], code=code))
        for yr in (a.season - 1, a.season - 2):  # recent seasons' cutouts
            if data or last_season < yr:
                continue
            slugs = [SLUGS.get(team_id)] + OLD_SLUGS
            for slug in dict.fromkeys(filter(None, slugs)):
                data = fetch(IMG.format(season=yr, team=slug, code=code))
                if data:
                    break
        if not data:  # legacy head-and-shoulders cutouts
            for url in legacy_urls(first, last, code):
                data = fetch(url)
                if data:
                    break
        if not data:
            missing.append(f"{did} ({code})")
            continue
        make_crops(data, did, bust, half)
        credits[did] = "Formula 1"
        print(f"   {did}: {code}")

    # era-correct photos: formula1.com keeps each driver's photo per season for the last two seasons
    for yr in (a.season - 1, a.season - 2):
        rows_ = db.execute("""
            SELECT d.driver_id, d.given_name, d.family_name, s.constructor_id
            FROM driver_standings s JOIN drivers d USING (driver_id)
            WHERE s.season=? AND s.round=(SELECT MAX(round) FROM driver_standings WHERE season=?)""", (yr, yr)).fetchall()
        got = 0
        for did, first, last, team_id in rows_:
            dest = OUT_SEASON / str(yr) / f"{did}.webp"
            if dest.exists() and not a.force:
                got += 1
                continue
            code = CODE_FIXES.get(did) or f1_code(first, last)
            slugs = [SEASON_SLUGS.get(yr, {}).get(team_id), SLUGS.get(team_id)] + OLD_SLUGS
            for slug in dict.fromkeys(filter(None, slugs)):
                data = fetch(IMG.format(season=yr, team=slug, code=code))
                if data:
                    make_crops(data, did, dest)
                    got += 1
                    break
        print(f"   {yr}: {got}/{len(rows_)} season photos")

    season_photos_older(db, a)

    still_missing = []
    for item in missing:
        did = item.split()[0]
        if cutout_from_portrait(did, credits):
            print(f"   {did}: cut out from Wikimedia portrait")
        else:
            still_missing.append(item)
    missing = still_missing

    (OUT / "credits.json").write_text(json.dumps(
        {k: v if isinstance(v, dict) else
         {"title": "Official driver photo", "author": v,
          "license": "© Formula One World Championship Ltd", "url": "https://www.formula1.com/en/drivers"}
         for k, v in credits.items()}, indent=1))
    print(f"done: {len(credits)} headshots" + (f"; not found: {', '.join(missing)}" if missing else ""))


if __name__ == "__main__":
    main()
