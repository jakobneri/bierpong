const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
try {
  fs.accessSync(dataDir, fs.constants.W_OK);
} catch (err) {
  console.error(
    `FATAL: data directory "${dataDir}" is not writable by this process.\n` +
    'If you are not running inside Docker, remove/unset DATA_DIR in your .env ' +
    '(it defaults to a writable ./data folder in the project).'
  );
  process.exit(1);
}

const dbPath = path.join(dataDir, 'bierpong.db');
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    team1_score INTEGER NOT NULL,
    team2_score INTEGER NOT NULL,
    winner INTEGER NOT NULL CHECK (winner IN (1, 2)),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT
  );

  CREATE TABLE IF NOT EXISTS match_players (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    team INTEGER NOT NULL CHECK (team IN (1, 2)),
    PRIMARY KEY (match_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expire INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
`);

module.exports = db;
