const session = require('express-session');
const db = require('./db');

class SqliteSessionStore extends session.Store {
  constructor() {
    super();
    this.getStmt = db.prepare('SELECT sess, expire FROM sessions WHERE sid = ?');
    this.upsertStmt = db.prepare(`
      INSERT INTO sessions (sid, sess, expire) VALUES (?, ?, ?)
      ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expire = excluded.expire
    `);
    this.destroyStmt = db.prepare('DELETE FROM sessions WHERE sid = ?');
    this.clearExpiredStmt = db.prepare('DELETE FROM sessions WHERE expire < ?');

    this.cleanupInterval = setInterval(() => {
      try {
        this.clearExpiredStmt.run(Date.now());
      } catch (err) {
        // ignore cleanup errors
      }
    }, 15 * 60 * 1000);
    this.cleanupInterval.unref();
  }

  get(sid, cb) {
    try {
      const row = this.getStmt.get(sid);
      if (!row) return cb(null, null);
      if (row.expire < Date.now()) {
        this.destroyStmt.run(sid);
        return cb(null, null);
      }
      cb(null, JSON.parse(row.sess));
    } catch (err) {
      cb(err);
    }
  }

  set(sid, sessionData, cb) {
    try {
      const maxAge = sessionData.cookie && sessionData.cookie.maxAge
        ? sessionData.cookie.maxAge
        : 24 * 60 * 60 * 1000;
      const expire = Date.now() + maxAge;
      this.upsertStmt.run(sid, JSON.stringify(sessionData), expire);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  destroy(sid, cb) {
    try {
      this.destroyStmt.run(sid);
      cb && cb(null);
    } catch (err) {
      cb && cb(err);
    }
  }

  touch(sid, sessionData, cb) {
    this.set(sid, sessionData, cb);
  }
}

module.exports = SqliteSessionStore;
