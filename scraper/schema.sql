-- F1 statistics database schema (SQLite).
-- Designed for multiple seasons: every event-level table is keyed by (season, round).
PRAGMA foreign_keys = ON;

-- ---------- Reference / dimension tables ----------
CREATE TABLE IF NOT EXISTS circuits (
    circuit_id   TEXT PRIMARY KEY,          -- e.g. 'interlagos'
    name         TEXT NOT NULL,
    locality     TEXT,
    country      TEXT,
    lat          REAL,
    lng          REAL,
    wiki_url     TEXT
);

CREATE TABLE IF NOT EXISTS drivers (
    driver_id        TEXT PRIMARY KEY,      -- e.g. 'norris'
    code             TEXT,                  -- e.g. 'NOR'
    permanent_number INTEGER,
    given_name       TEXT NOT NULL,
    family_name      TEXT NOT NULL,
    date_of_birth    TEXT,                  -- ISO date
    nationality      TEXT,
    wiki_url         TEXT
);

CREATE TABLE IF NOT EXISTS constructors (
    constructor_id TEXT PRIMARY KEY,        -- e.g. 'mclaren'
    name           TEXT NOT NULL,
    nationality    TEXT,
    wiki_url       TEXT
);

CREATE TABLE IF NOT EXISTS seasons (
    season   INTEGER PRIMARY KEY,
    wiki_url TEXT
);

-- ---------- Calendar ----------
CREATE TABLE IF NOT EXISTS races (
    season              INTEGER NOT NULL REFERENCES seasons(season),
    round               INTEGER NOT NULL,
    race_name           TEXT NOT NULL,
    circuit_id          TEXT NOT NULL REFERENCES circuits(circuit_id),
    race_date           TEXT NOT NULL,      -- ISO date
    race_time_utc       TEXT,               -- HH:MM:SSZ
    fp1_datetime_utc    TEXT,
    fp2_datetime_utc    TEXT,
    fp3_datetime_utc    TEXT,
    quali_datetime_utc  TEXT,
    sprint_quali_datetime_utc TEXT,
    sprint_datetime_utc TEXT,
    is_sprint_weekend   INTEGER NOT NULL DEFAULT 0,
    is_completed        INTEGER NOT NULL DEFAULT 0,  -- 1 once race results exist
    wiki_url            TEXT,
    PRIMARY KEY (season, round)
);

-- ---------- Session results ----------
CREATE TABLE IF NOT EXISTS race_results (
    season             INTEGER NOT NULL,
    round              INTEGER NOT NULL,
    driver_id          TEXT NOT NULL REFERENCES drivers(driver_id),
    constructor_id     TEXT NOT NULL REFERENCES constructors(constructor_id),
    car_number         INTEGER,
    grid               INTEGER,            -- 0 = pit lane start
    position           INTEGER,            -- classified finishing order (always set by source)
    position_text      TEXT,               -- '1'.. or 'R' (retired), 'D' (DSQ), 'W', 'N'
    points             REAL NOT NULL DEFAULT 0,
    laps               INTEGER,
    status             TEXT,               -- 'Finished', 'Lapped', 'Retired', ...
    time_millis        INTEGER,            -- total race time (finishers on lead lap)
    time_text          TEXT,               -- '1:35:23.504' or '+5.123'
    fastest_lap_rank   INTEGER,
    fastest_lap_number INTEGER,
    fastest_lap_time   TEXT,
    fastest_lap_ms     INTEGER,
    PRIMARY KEY (season, round, driver_id),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

CREATE TABLE IF NOT EXISTS sprint_results (
    season             INTEGER NOT NULL,
    round              INTEGER NOT NULL,
    driver_id          TEXT NOT NULL REFERENCES drivers(driver_id),
    constructor_id     TEXT NOT NULL REFERENCES constructors(constructor_id),
    car_number         INTEGER,
    grid               INTEGER,
    position           INTEGER,
    position_text      TEXT,
    points             REAL NOT NULL DEFAULT 0,
    laps               INTEGER,
    status             TEXT,
    time_millis        INTEGER,
    time_text          TEXT,
    fastest_lap_rank   INTEGER,
    fastest_lap_number INTEGER,
    fastest_lap_time   TEXT,
    fastest_lap_ms     INTEGER,
    PRIMARY KEY (season, round, driver_id),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

CREATE TABLE IF NOT EXISTS qualifying_results (
    season         INTEGER NOT NULL,
    round          INTEGER NOT NULL,
    driver_id      TEXT NOT NULL REFERENCES drivers(driver_id),
    constructor_id TEXT NOT NULL REFERENCES constructors(constructor_id),
    car_number     INTEGER,
    position       INTEGER,
    q1             TEXT,  q1_ms INTEGER,
    q2             TEXT,  q2_ms INTEGER,
    q3             TEXT,  q3_ms INTEGER,
    PRIMARY KEY (season, round, driver_id),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

-- ---------- Race detail ----------
CREATE TABLE IF NOT EXISTS lap_times (
    season    INTEGER NOT NULL,
    round     INTEGER NOT NULL,
    driver_id TEXT NOT NULL REFERENCES drivers(driver_id),
    lap       INTEGER NOT NULL,
    position  INTEGER,                     -- running position at end of lap
    time_text TEXT,
    time_ms   INTEGER,
    PRIMARY KEY (season, round, driver_id, lap),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

CREATE TABLE IF NOT EXISTS pit_stops (
    season        INTEGER NOT NULL,
    round         INTEGER NOT NULL,
    driver_id     TEXT NOT NULL REFERENCES drivers(driver_id),
    stop          INTEGER NOT NULL,
    lap           INTEGER,
    time_of_day   TEXT,                    -- local wall-clock time of stop
    duration_text TEXT,                    -- pit-lane time, e.g. '22.345'
    duration_ms   INTEGER,
    PRIMARY KEY (season, round, driver_id, stop),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

-- ---------- Championship standings after each round ----------
CREATE TABLE IF NOT EXISTS driver_standings (
    season         INTEGER NOT NULL,
    round          INTEGER NOT NULL,
    driver_id      TEXT NOT NULL REFERENCES drivers(driver_id),
    constructor_id TEXT,                   -- most recent team for that driver
    position       INTEGER,
    position_text  TEXT,
    points         REAL NOT NULL,
    wins           INTEGER NOT NULL,
    PRIMARY KEY (season, round, driver_id),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

CREATE TABLE IF NOT EXISTS constructor_standings (
    season         INTEGER NOT NULL,
    round          INTEGER NOT NULL,
    constructor_id TEXT NOT NULL REFERENCES constructors(constructor_id),
    position       INTEGER,
    position_text  TEXT,
    points         REAL NOT NULL,
    wins           INTEGER NOT NULL,
    PRIMARY KEY (season, round, constructor_id),
    FOREIGN KEY (season, round) REFERENCES races(season, round)
);

-- ---------- Bookkeeping ----------
CREATE TABLE IF NOT EXISTS scrape_log (
    scraped_at TEXT NOT NULL,
    season     INTEGER NOT NULL,
    source     TEXT NOT NULL,
    notes      TEXT
);

-- ---------- Indexes for common webpage queries ----------
CREATE INDEX IF NOT EXISTS ix_race_results_driver ON race_results(driver_id, season);
CREATE INDEX IF NOT EXISTS ix_race_results_team   ON race_results(constructor_id, season);
CREATE INDEX IF NOT EXISTS ix_quali_driver        ON qualifying_results(driver_id, season);
CREATE INDEX IF NOT EXISTS ix_laps_driver         ON lap_times(driver_id, season, round);
CREATE INDEX IF NOT EXISTS ix_pits_driver         ON pit_stops(driver_id, season, round);

-- ---------- Convenience views for the webpage ----------
DROP VIEW IF EXISTS v_driver_season_stats;
CREATE VIEW v_driver_season_stats AS
SELECT
    r.season,
    r.driver_id,
    d.code,
    d.given_name || ' ' || d.family_name                 AS driver_name,
    COUNT(*)                                             AS starts,
    SUM(r.position = 1)                                  AS wins,
    SUM(r.position <= 3 AND r.position_text GLOB '[0-9]*') AS podiums,
    SUM(r.points > 0)                                    AS points_finishes,
    SUM(r.grid = 1)                                      AS race_pole_starts,
    SUM(r.fastest_lap_rank = 1)                          AS fastest_laps,
    SUM(r.position_text NOT GLOB '[0-9]*')               AS dnfs,
    ROUND(AVG(CASE WHEN r.position_text GLOB '[0-9]*' THEN r.position END), 2) AS avg_finish,
    ROUND(AVG(NULLIF(r.grid, 0)), 2)                     AS avg_grid,
    SUM(r.laps)                                          AS laps_completed,
    SUM(r.points)                                        AS race_points,
    COALESCE((SELECT SUM(s.points) FROM sprint_results s
              WHERE s.season = r.season AND s.driver_id = r.driver_id), 0) AS sprint_points
FROM race_results r
JOIN drivers d USING (driver_id)
GROUP BY r.season, r.driver_id;

DROP VIEW IF EXISTS v_constructor_season_stats;
CREATE VIEW v_constructor_season_stats AS
SELECT
    r.season,
    r.constructor_id,
    c.name                                   AS constructor_name,
    COUNT(*)                                 AS car_starts,
    SUM(r.position = 1)                      AS wins,
    SUM(r.position <= 3 AND r.position_text GLOB '[0-9]*') AS podiums,
    SUM(r.position_text NOT GLOB '[0-9]*')   AS dnfs,
    SUM(r.points)                            AS race_points
FROM race_results r
JOIN constructors c USING (constructor_id)
GROUP BY r.season, r.constructor_id;

DROP VIEW IF EXISTS v_race_winners;
CREATE VIEW v_race_winners AS
SELECT ra.season, ra.round, ra.race_name, ra.race_date, ci.country,
       d.given_name || ' ' || d.family_name AS winner, c.name AS team,
       rr.grid AS winner_grid, rr.time_text AS race_time,
       (SELECT d2.given_name || ' ' || d2.family_name FROM qualifying_results q
          JOIN drivers d2 USING (driver_id)
         WHERE q.season = ra.season AND q.round = ra.round AND q.position = 1) AS pole_sitter
FROM races ra
JOIN circuits ci USING (circuit_id)
JOIN race_results rr ON rr.season = ra.season AND rr.round = ra.round AND rr.position = 1
JOIN drivers d ON d.driver_id = rr.driver_id
JOIN constructors c ON c.constructor_id = rr.constructor_id;

DROP VIEW IF EXISTS v_head_to_head_quali;
CREATE VIEW v_head_to_head_quali AS
-- teammate qualifying battles: one row per pair of teammates per race
SELECT a.season, a.round, a.constructor_id,
       a.driver_id AS driver_a, b.driver_id AS driver_b,
       a.position AS pos_a, b.position AS pos_b,
       CASE WHEN a.position < b.position THEN a.driver_id ELSE b.driver_id END AS ahead
FROM qualifying_results a
JOIN qualifying_results b
  ON a.season = b.season AND a.round = b.round
 AND a.constructor_id = b.constructor_id AND a.driver_id < b.driver_id;
