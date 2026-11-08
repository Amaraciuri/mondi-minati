-- Mined Worlds: online leaderboard for the daily challenge (Cloudflare D1).
-- npx wrangler d1 execute mondi-minati --remote --file=worker/schema.sql

-- one row per player per daily planet: their best time (deleted after 30 days, see /privacy)
CREATE TABLE IF NOT EXISTS scores (
  day     TEXT    NOT NULL,  -- UTC day of the daily planet, YYYY-MM-DD
  player  TEXT    NOT NULL,  -- random id kept in the player's browser, never sent back by the API
  nick    TEXT    NOT NULL,
  ms      INTEGER NOT NULL,  -- official time in milliseconds
  moves   INTEGER NOT NULL,
  run     TEXT    NOT NULL,  -- id of the checked run: one result can't go up under several names
  created INTEGER NOT NULL,  -- when this best time was set (unix ms)
  PRIMARY KEY (day, player)
);
CREATE INDEX IF NOT EXISTS scores_by_time ON scores (day, ms, created);
CREATE UNIQUE INDEX IF NOT EXISTS scores_by_run ON scores (day, run);
CREATE INDEX IF NOT EXISTS scores_by_player ON scores (player);

-- the daily planet, built once per day so that checking a run stays cheap
CREATE TABLE IF NOT EXISTS boards (
  day     TEXT PRIMARY KEY,
  data    TEXT    NOT NULL,  -- JSON: start cell, neighbour lists, mines
  created INTEGER NOT NULL
);

-- server secret: picks the daily planet and signs run tokens
CREATE TABLE IF NOT EXISTS config (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT OR IGNORE INTO config (k, v) VALUES ('secret', lower(hex(randomblob(32))));

-- submissions per network per day (hashed), to slow down floods
CREATE TABLE IF NOT EXISTS limits (
  k TEXT PRIMARY KEY,        -- day:hash
  n INTEGER NOT NULL
);
