# Pitwall 26 — frontend

Vite + React + TypeScript, GSAP ScrollTrigger + Lenis for the scroll choreography.

```bash
npm install
npm run data    # export data/f1.db -> public/data/seasons/<year>.json + index.json (every season; safe while scraping)
npm run media   # fetch portraits, team emblems, scene photos -> public/media (+ manifest.json with credits)
npm run headshots # official formula1.com cutouts for every season's drivers -> public/media/overrides
                  # (personal use only, (c) FOM). Drivers F1 no longer hosts get a background-removed
                  # Wikimedia portrait if `rembg` is installed: run the script with a venv that has
                  # `pip install "rembg[cpu]"`, then `npm run media`.
npm run dev     # http://localhost:5173
```

Re-run `npm run data` whenever the scraper adds rounds; the page reads the JSON on load.

## Where things live
- `src/styles/global.css` – design tokens for **dark** and **light** themes at the top, then the glass system and each section.
- `src/lib/teams.ts` – team accent colours, short names, and whether a logo needs a light or dark plate.
- `scripts/media_sources.json` – the scene photos (Wikimedia Commons). Add/remove entries, then `npm run media`.
- `public/media/overrides/{drivers,teams}/<id>.png|svg|webp` – drop in your own image and rerun `npm run media`; overrides always win.
- `src/lib/data.ts` – the single data-loading function (swap for an API later).

## Seasons
Every season in the DB is selectable: the pit-board button in the nav (or the season control by the title)
opens **Pick a lap** — seasons are marshal posts round a circuit; choosing one drives the car there, then a
chequered flag swaps the page to that season. `?season=2021` deep-links; the current season has no param.
Each season can have its own landing photo: add a `hero-<year>` scene in `scripts/media_sources.json`.
Driver photos are era-correct where formula1.com still has them (last two seasons); older seasons use each
driver's latest official photo.

## Sections (top → bottom)
Standings (landing, tabs: Drivers / Constructors / Side by side) → name marquee → Leaders podium →
Title-fight chart → Moments (pinned horizontal reel) → Calendar with countdown → credits footer.
Each `<section data-scene="…" data-side="left|right|full">` picks the background photo shown while it is on screen.
