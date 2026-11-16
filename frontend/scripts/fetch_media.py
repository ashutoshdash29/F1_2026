#!/usr/bin/env python3
"""
Download the images the frontend uses into frontend/public/media and write
frontend/public/media/manifest.json (paths + author/licence credits).

  * Driver portraits  - lead image of each driver's Wikipedia page (wiki_url in the DB)
  * Team logos        - lead image of each constructor's Wikipedia page
  * Scene photos      - the Wikimedia Commons files listed in scripts/media_sources.json

Files already on disk are skipped, so reruns are cheap (use --force to refetch).
If ImageMagick (`magick`) is installed, photos are converted to compact .webp.

Want a different picture? Drop a file in
    public/media/overrides/drivers/<driver_id>.(png|jpg|webp)
    public/media/overrides/teams/<constructor_id>.(svg|png|webp)
and rerun - overrides always win.

Usage:  python3 frontend/scripts/fetch_media.py [--season 2026] [--force]
"""
import argparse
import html
import json
import re
import shutil
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FRONT = ROOT / "frontend"
MEDIA = FRONT / "public" / "media"
DB = ROOT / "data" / "f1.db"
SOURCES = Path(__file__).with_name("media_sources.json")
UA = "f1-stats-frontend/0.1 (personal, non-commercial project)"
WIKI_API = "https://en.wikipedia.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
MAGICK = shutil.which("magick")

_last = 0.0


def get(url, binary=False):
    """Polite GET with pacing + backoff (Wikimedia rate-limits bursts)."""
    global _last
    for attempt in range(7):
        wait = 1.1 - (time.time() - _last)
        if wait > 0:
            time.sleep(wait)
        _last = time.time()
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": UA}), timeout=60) as r:
                data = r.read()
                return data if binary else json.loads(data)
        except urllib.error.HTTPError as e:
            if e.code in (429, 500, 502, 503, 504):
                back = min(90, 6 * 2 ** attempt)
                print(f"   HTTP {e.code}; retry in {back}s", file=sys.stderr)
                time.sleep(back)
                continue
            raise
        except (urllib.error.URLError, json.JSONDecodeError) as e:
            print(f"   {e}; retrying", file=sys.stderr)
            time.sleep(5)
    raise RuntimeError(f"giving up: {url}")


def api(base, **params):
    params = {"action": "query", "format": "json", "formatversion": "2", **params}
    return get(base + "?" + urllib.parse.urlencode(params))


def title_from_url(url):
    return urllib.parse.unquote(url.rsplit("/wiki/", 1)[-1]).replace("_", " ")


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def lead_images(titles, size):
    """{page title -> (thumb url, file name)} for Wikipedia pages, any licence (logos are often non-free)."""
    out = {}
    for i in range(0, len(titles), 40):
        chunk = titles[i:i + 40]
        d = api(WIKI_API, prop="pageimages", piprop="thumbnail|name", pithumbsize=size,
                pilicense="any", redirects=1, titles="|".join(chunk))
        q = d["query"]
        alias = {}
        for k in ("normalized", "redirects"):
            for m in q.get(k, []):
                alias[m["to"]] = alias.get(m["from"], m["from"])
        for p in q["pages"]:
            if "thumbnail" in p:
                src = p["title"]
                while src in alias:
                    src = alias[src]
                out[src] = (p["thumbnail"]["source"], "File:" + p["pageimage"])
                out[p["title"]] = out[src]
    return out


def credits(files, base=WIKI_API):
    out = {}
    for i in range(0, len(files), 40):
        d = api(base, prop="imageinfo", iiprop="extmetadata|url", titles="|".join(files[i:i + 40]))
        q = d["query"]
        back = {m["to"]: m["from"] for m in q.get("normalized", [])}
        for p in q["pages"]:
            ii = (p.get("imageinfo") or [{}])[0]
            m = ii.get("extmetadata", {})
            c = {"title": p["title"].removeprefix("File:"),
                 "author": strip(m.get("Artist", {}).get("value")) or None,
                 "license": strip(m.get("LicenseShortName", {}).get("value")) or None,
                 "url": ii.get("descriptionurl")}
            out[p["title"]] = c
            out[back.get(p["title"], p["title"])] = c
    return out


def save(url, dest_noext, kind, force):
    """Download url; convert with ImageMagick when available. Returns path relative to public/."""
    ext = Path(urllib.parse.urlparse(url).path).suffix.lower() or ".jpg"
    if ext == ".svg":
        ext = ".png"  # thumbnails of svgs are png
    photo = kind in ("scene", "driver") and MAGICK
    final = dest_noext.with_suffix(".webp" if photo else ext)
    if final.exists() and not force:
        return final.relative_to(FRONT / "public").as_posix()
    final.parent.mkdir(parents=True, exist_ok=True)
    data = get(url, binary=True)
    if photo:
        raw = final.with_suffix(".src" + ext)
        raw.write_bytes(data)
        args = {"scene": ["-resize", "2400x>", "-quality", "80"],
                "driver": ["-resize", "720x>", "-quality", "84"]}[kind]
        subprocess.run([MAGICK, str(raw), "-strip", *args, str(final)], check=True)
        raw.unlink()
    else:
        final.write_bytes(data)
    print(f"   saved {final.relative_to(FRONT)}")
    return final.relative_to(FRONT / "public").as_posix()


def make_emblem(data, e, dest):
    """Trim -> crop the emblem out of the full logo -> key out / recolour -> trim -> transparent PNG."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    raw = dest.with_suffix(".src")
    raw.write_bytes(data)
    trimmed = dest.with_suffix(".trim.png")
    subprocess.run([MAGICK, str(raw), "-background", "none", "-trim", "+repage", str(trimmed)], check=True)
    w, h = map(int, subprocess.run([MAGICK, "identify", "-format", "%w %h", str(trimmed)],
                                   capture_output=True, text=True, check=True).stdout.split())
    args = [MAGICK, str(trimmed)]
    if e.get("crop"):
        x, y, cw, ch = e["crop"]
        args += ["-crop", f"{round(cw * w)}x{round(ch * h)}+{round(x * w)}+{round(y * h)}", "+repage"]
    if e.get("transparent"):
        args += ["-fuzz", f"{e.get('fuzz', 15)}%", "-transparent", e["transparent"]]
    if e.get("fill"):
        args += ["-fill", e["fill"], "-colorize", "100"]
    args += ["-trim", "+repage", "-resize", "512x512>", "-strip", str(dest)]
    subprocess.run(args, check=True)
    raw.unlink()
    trimmed.unlink()
    print(f"   saved {dest.relative_to(FRONT)}")


def override_credit(kind, ident):
    f = MEDIA / "overrides" / kind / "credits.json"
    return json.loads(f.read_text()).get(ident) if f.exists() else None


def override(kind, ident):
    for ext in (".svg", ".png", ".webp", ".jpg", ".jpeg"):
        p = MEDIA / "overrides" / kind / f"{ident}{ext}"
        if p.exists():
            return p.relative_to(FRONT / "public").as_posix()
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--season", type=int, default=2026)
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()

    db = sqlite3.connect(f"file:{DB}?mode=ro", uri=True, timeout=15)
    # every driver / constructor that appears in any season's standings (season picker covers them all)
    drivers = db.execute("""SELECT DISTINCT d.driver_id, d.wiki_url FROM drivers d
                            JOIN driver_standings s USING (driver_id)""").fetchall()
    teams = db.execute("""SELECT DISTINCT c.constructor_id, c.wiki_url FROM constructors c
                          JOIN constructor_standings s USING (constructor_id)""").fetchall()

    old = {}
    mf = MEDIA / "manifest.json"
    if mf.exists():
        old = json.loads(mf.read_text())
    manifest = {"drivers": {}, "teams": {}, "scenes": {}}

    for kind, items, size, sub in (("driver", drivers, 960, "drivers"), ("team", teams, 500, "teams")):
        print(f"== {sub}")
        titles = [title_from_url(u) for _, u in items if u]
        imgs = lead_images(titles, size)
        creds = credits(sorted({f for _, f in imgs.values()}))
        for ident, url in items:
            ov = override(sub, ident)
            if ov:
                entry = {"src": ov, "credit": override_credit(sub, ident)}
                half = override(sub + "_half", ident)  # optional half-body crop (official headshots)
                if half:
                    entry["half"] = half
                if sub == "drivers":  # era-correct photos per season, where they exist
                    by = {d.name: override(f"drivers_season/{d.name}", ident)
                          for d in sorted((MEDIA / "overrides" / "drivers_season").glob("*")) if d.is_dir()}
                    by = {k: v for k, v in by.items() if v}
                    if by:
                        entry["bySeason"] = by
                manifest[sub][ident] = entry
                continue
            hit = imgs.get(title_from_url(url)) if url else None
            if not hit:
                print(f"   no image for {ident}")
                continue
            thumb, fname = hit
            try:
                src = save(thumb, MEDIA / sub / ident, kind, a.force)
            except Exception as e:  # keep going; the UI falls back to initials
                print(f"   failed {ident}: {e}", file=sys.stderr)
                prev = old.get(sub, {}).get(ident)
                if prev:
                    manifest[sub][ident] = prev
                continue
            manifest[sub][ident] = {"src": src, "credit": creds.get(fname)}

    print("== emblems")
    emblems = json.loads(SOURCES.read_text()).get("emblems", [])
    if emblems and not MAGICK:
        print("   ImageMagick not found - keeping full team logos instead of emblems")
    elif emblems:
        team_ids = {t for t, _ in teams}
        wanted = [e for e in emblems if e["id"] in team_ids and not override("teams", e["id"])]
        info = {}
        files = [e["file"] for e in wanted]
        for i in range(0, len(files), 40):
            # en.wikipedia resolves both local (non-free logo) files and Commons files
            d = api(WIKI_API, prop="imageinfo", iiprop="url|extmetadata", iiurlwidth=1280,
                    titles="|".join(files[i:i + 40]))
            back = {m["to"]: m["from"] for m in d["query"].get("normalized", [])}
            for p in d["query"]["pages"]:
                info[back.get(p["title"], p["title"])] = p
        for e in wanted:
            p = info.get(e["file"])
            if not p or "imageinfo" not in p:
                print(f"   missing: {e['file']}")
                continue
            ii = p["imageinfo"][0]
            m = ii.get("extmetadata", {})
            dest = MEDIA / "emblems" / f"{e['id']}.png"
            try:
                if a.force or not dest.exists():
                    make_emblem(get(ii.get("thumburl") or ii["url"], binary=True), e, dest)
            except Exception as ex:
                print(f"   failed {e['id']}: {ex}", file=sys.stderr)
                continue
            manifest["teams"][e["id"]] = {
                "src": dest.relative_to(FRONT / "public").as_posix(),
                "credit": {"title": p["title"].removeprefix("File:"),
                           "author": strip(m.get("Artist", {}).get("value")) or None,
                           "license": strip(m.get("LicenseShortName", {}).get("value")) or None,
                           "url": ii.get("descriptionurl")},
            }

    print("== scenes")
    src_json = json.loads(SOURCES.read_text())
    # scene photos + each season's "moments" (season/round/kind are passed through to the manifest)
    scenes = src_json["scenes"] + src_json.get("moments", [])
    files = [s["file"] for s in scenes]
    info = {}
    for i in range(0, len(files), 40):
        d = api(COMMONS_API, prop="imageinfo", iiprop="url|size|extmetadata", iiurlwidth=1920,
                titles="|".join(files[i:i + 40]))
        back = {m["to"]: m["from"] for m in d["query"].get("normalized", [])}
        for p in d["query"]["pages"]:
            info[back.get(p["title"], p["title"])] = p
    for s in scenes:
        p = info.get(s["file"])
        if not p or "imageinfo" not in p:
            print(f"   missing on Commons: {s['file']}")
            continue
        ii = p["imageinfo"][0]
        m = ii.get("extmetadata", {})
        try:
            src = save(ii.get("thumburl") or ii["url"], MEDIA / "scenes" / s["id"], "scene", a.force)
        except Exception as e:  # one stubborn file must not sink the whole run
            print(f"   skipped {s['id']}: {e}", file=sys.stderr)
            continue
        manifest["scenes"][s["id"]] = {
            "src": src, "caption": s.get("caption"), "place": s.get("place"),
            "focus": s.get("focus", "50% 50%"),
            **{k: s[k] for k in ("season", "round", "kind") if k in s},
            "credit": {"title": p["title"].removeprefix("File:"),
                       "author": strip(m.get("Artist", {}).get("value")) or None,
                       "license": strip(m.get("LicenseShortName", {}).get("value")) or None,
                       "url": ii.get("descriptionurl")},
        }

    mf.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
    print(f"wrote {mf.relative_to(ROOT)}: {len(manifest['drivers'])} drivers, "
          f"{len(manifest['teams'])} teams, {len(manifest['scenes'])} scenes")


if __name__ == "__main__":
    main()
