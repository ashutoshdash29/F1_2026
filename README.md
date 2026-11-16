# F1 Stats

Formula 1 statistics website. The data comes from the [Jolpica F1 API](https://api.jolpi.ca/ergast/f1/2026/) and is stored in a SQLite database. It covers the 2015–2026 seasons.

## Requirements

- Python 3.9 or newer (the scraper uses only the standard library, so there's nothing to install)
- `sqlite3` command-line tool (optional, for looking at the data)

## Project layout

```
scraper/scrape.py       # downloads season data into the database
scraper/dump_import.py  # loads lap times, pit stops and standings from the Jolpica dump
scraper/schema.sql      # tables, indexes and views
data/f1.db              # the SQLite database the website reads from
data/raw/               # cached API responses (safe to delete)
data/dump/              # downloaded Jolpica CSV dump (safe to delete)
```

## Quick start

1. Build or update the database:

   ```bash
   python3 scraper/scrape.py --refresh
   ```

2. Check it worked:

   ```bash
   sqlite3 data/f1.db "SELECT * FROM v_race_winners;"
   ```

3. Point the website at `data/f1.db`.

## Scraper command

```bash
python3 scraper/scrape.py [--season SEASONS] [--refresh] [--details auto|api|dump] [--db PATH]
```

| Option | Default | What it does |
|---|---|---|
| `--season` | current year | One season (`2026`), a range (`2015-2025`) or a list (`2019,2021`) |
| `--refresh` | off | Re-download the calendar and any race not fetched yet. **Use this after every Grand Prix.** |
| `--details` | `auto` | Where lap times, pit stops and standings come from. `auto` uses the CSV dump for past seasons and the API for the current one. |
| `--redownload-dump` | off | Download a fresh copy of the CSV dump |
| `--db` | `data/f1.db` | Where to write the database |

Common commands:

```bash
python3 scraper/scrape.py --refresh               # after each race this season
python3 scraper/scrape.py --season 2015-2026      # rebuild everything
python3 scraper/scrape.py --season 2014           # add an older season
```

- Rounds that haven't been raced yet are skipped. Rerun the command after each race to add it.
- Results, qualifying and sprints always come from the API. Past seasons' lap times, pit stops and standings come from the [Jolpica CSV dump](https://api.jolpi.ca/data/dumps/download/delayed/?dump_type=csv), which is one ~15 MB download and saves thousands of API calls.
- The dump is a few weeks behind, so the current season uses the API for everything. Fetching a current season from scratch takes about 10 minutes because of the API's rate limit. Pauses with `HTTP 429` messages are normal, and the scraper retries on its own.
- Downloaded data is cached in `data/raw/` and `data/dump/`, so reruns are fast. To rebuild from scratch, delete `data/f1.db`, `data/raw/` and `data/dump/`.

## Data available

| Table | Contents |
|---|---|
| `races` | Calendar, session times, sprint-weekend and completed flags |
| `race_results`, `sprint_results` | Grid, finish, points, status, fastest lap |
| `qualifying_results` | Q1, Q2 and Q3 times |
| `lap_times` | Every lap for every driver |
| `pit_stops` | Lap and duration of each stop |
| `driver_standings`, `constructor_standings` | Championship table after each round |
| `drivers`, `constructors`, `circuits` | Reference data |

Views the website can use directly:

| View | What it gives |
|---|---|
| `v_driver_season_stats` | Per-driver season totals: wins, podiums, DNFs, averages, points |
| `v_constructor_season_stats` | Per-team season totals |
| `v_race_winners` | Winner, team, starting grid position and pole-sitter for each race |
| `v_head_to_head_quali` | Which teammate qualified ahead at each race |

Every table is keyed by `(season, round)`, so filter by `season` in every query.
