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

  CREATE TABLE IF NOT EXISTS parties (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK (mode IN ('1v1', '2v2')),
    status TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'active', 'finished')),
    created_by INTEGER NOT NULL REFERENCES users(id),
    rack_size INTEGER NOT NULL DEFAULT 10,
    team1_cups TEXT NOT NULL DEFAULT '[]',
    team2_cups TEXT NOT NULL DEFAULT '[]',
    current_turn_team INTEGER NOT NULL DEFAULT 1 CHECK (current_turn_team IN (1, 2)),
    throws_this_turn INTEGER NOT NULL DEFAULT 0,
    match_id INTEGER REFERENCES matches(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS party_players (
    party_id INTEGER NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id),
    team INTEGER NOT NULL CHECK (team IN (1, 2)),
    joined_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (party_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS solo_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    shots_made INTEGER NOT NULL,
    shots_taken INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_match_players_user ON match_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
  CREATE INDEX IF NOT EXISTS idx_sessions_expire ON sessions(expire);
  CREATE INDEX IF NOT EXISTS idx_party_players_user ON party_players(user_id);
  CREATE INDEX IF NOT EXISTS idx_parties_code ON parties(code);
  CREATE INDEX IF NOT EXISTS idx_solo_sessions_user ON solo_sessions(user_id);
`);

function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

ensureColumn('users', 'is_admin', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('users', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('users', 'is_management', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('matches', 'party_id', 'INTEGER REFERENCES parties(id)');
ensureColumn('solo_sessions', 'cup_hits', "TEXT NOT NULL DEFAULT '[0,0,0,0,0,0,0,0,0,0]'");
ensureColumn('parties', 'current_turn_team', 'INTEGER NOT NULL DEFAULT 1');
ensureColumn('parties', 'throws_this_turn', 'INTEGER NOT NULL DEFAULT 0');

// If ADMIN_PASSWORD is set, keep a dedicated "admin" account in sync with
// it on every startup. This account is a pure management login (see
// is_management) - it never plays, so it never shows up in stats or the
// leaderboard.
if (process.env.ADMIN_PASSWORD) {
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12);
  const existingAdmin = db.prepare('SELECT id FROM users WHERE username = ?').get('admin');
  if (existingAdmin) {
    db.prepare('UPDATE users SET password_hash = ?, is_admin = 1, is_management = 1, is_active = 1 WHERE id = ?')
      .run(passwordHash, existingAdmin.id);
  } else {
    db.prepare(
      'INSERT INTO users (username, password_hash, is_admin, is_management, is_active) VALUES (?, ?, 1, 1, 1)'
    ).run('admin', passwordHash);
  }
}

// Bootstrap: if no admin exists yet (fresh install or upgrade of an
// existing database, and no ADMIN_PASSWORD configured), promote the
// earliest-registered user so the admin dashboard is reachable without
// manual SQL surgery.
const adminCount = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1').get().c;
if (adminCount === 0) {
  const firstUser = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (firstUser) {
    db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(firstUser.id);
  }
}

module.exports = db;
