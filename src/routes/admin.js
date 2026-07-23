const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');

const router = express.Router();

router.use(requireAuth, requireAdmin);

const overviewStmt = {
  users: db.prepare('SELECT COUNT(*) AS c FROM users'),
  activeUsers: db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_active = 1'),
  confirmedMatches: db.prepare("SELECT COUNT(*) AS c FROM matches WHERE status = 'confirmed'"),
  pendingMatches: db.prepare("SELECT COUNT(*) AS c FROM matches WHERE status = 'pending'"),
  rejectedMatches: db.prepare("SELECT COUNT(*) AS c FROM matches WHERE status = 'rejected'"),
  liveParties: db.prepare("SELECT COUNT(*) AS c FROM parties WHERE status IN ('waiting', 'active')"),
  recentUsers: db.prepare('SELECT username, created_at, is_admin FROM users ORDER BY id DESC LIMIT 8'),
  recentMatches: db.prepare(`
    SELECT m.id, m.mode, m.team1_score, m.team2_score, m.winner, m.status, m.created_at
    FROM matches m ORDER BY m.id DESC LIMIT 8
  `),
};

const matchPlayersStmt = db.prepare(`
  SELECT mp.team, u.username FROM match_players mp
  JOIN users u ON u.id = mp.user_id
  WHERE mp.match_id = ? ORDER BY mp.team, u.username
`);

router.get('/', (req, res) => {
  const recentMatches = overviewStmt.recentMatches.all().map((m) => {
    const rows = matchPlayersStmt.all(m.id);
    return {
      ...m,
      players: {
        team1: rows.filter((r) => r.team === 1).map((r) => r.username),
        team2: rows.filter((r) => r.team === 2).map((r) => r.username),
      },
    };
  });

  res.render('admin/overview', {
    title: 'Admin-Dashboard',
    stats: {
      users: overviewStmt.users.get().c,
      activeUsers: overviewStmt.activeUsers.get().c,
      confirmedMatches: overviewStmt.confirmedMatches.get().c,
      pendingMatches: overviewStmt.pendingMatches.get().c,
      rejectedMatches: overviewStmt.rejectedMatches.get().c,
      liveParties: overviewStmt.liveParties.get().c,
    },
    recentUsers: overviewStmt.recentUsers.all(),
    recentMatches,
  });
});

const usersListStmt = db.prepare(`
  SELECT
    u.id, u.username, u.created_at, u.is_admin, u.is_active,
    COUNT(m.id) AS games
  FROM users u
  LEFT JOIN match_players mp ON mp.user_id = u.id
  LEFT JOIN matches m ON m.id = mp.match_id AND m.status = 'confirmed'
  GROUP BY u.id
  ORDER BY u.username ASC
`);

router.get('/users', (req, res) => {
  res.render('admin/users', { title: 'Nutzerverwaltung', users: usersListStmt.all(), notice: null, error: null });
});

const getUserByIdStmt = db.prepare('SELECT * FROM users WHERE id = ?');
const setAdminStmt = db.prepare('UPDATE users SET is_admin = ? WHERE id = ?');
const setActiveStmt = db.prepare('UPDATE users SET is_active = ? WHERE id = ?');
const setPasswordStmt = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
const adminCountStmt = db.prepare('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');

function renderUsersWithMessage(res, status, notice, error) {
  res.status(status).render('admin/users', { title: 'Nutzerverwaltung', users: usersListStmt.all(), notice, error });
}

router.post('/users/:id/toggle-admin', csrfProtect, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const target = getUserByIdStmt.get(targetId);
  if (!target) return renderUsersWithMessage(res, 404, null, 'Nutzer nicht gefunden.');

  if (targetId === req.session.user.id && target.is_admin) {
    return renderUsersWithMessage(res, 400, null, 'Du kannst dir nicht selbst die Admin-Rechte entziehen.');
  }
  if (target.is_admin && adminCountStmt.get().c <= 1) {
    return renderUsersWithMessage(res, 400, null, 'Es muss mindestens ein Admin übrig bleiben.');
  }

  setAdminStmt.run(target.is_admin ? 0 : 1, targetId);
  renderUsersWithMessage(res, 200, `Admin-Status von "${target.username}" geändert.`, null);
});

router.post('/users/:id/toggle-active', csrfProtect, (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const target = getUserByIdStmt.get(targetId);
  if (!target) return renderUsersWithMessage(res, 404, null, 'Nutzer nicht gefunden.');

  if (targetId === req.session.user.id) {
    return renderUsersWithMessage(res, 400, null, 'Du kannst deinen eigenen Account nicht deaktivieren.');
  }

  setActiveStmt.run(target.is_active ? 0 : 1, targetId);
  renderUsersWithMessage(res, 200, `Account "${target.username}" ${target.is_active ? 'deaktiviert' : 'aktiviert'}.`, null);
});

router.post('/users/:id/reset-password', csrfProtect, async (req, res) => {
  const targetId = parseInt(req.params.id, 10);
  const target = getUserByIdStmt.get(targetId);
  if (!target) return renderUsersWithMessage(res, 404, null, 'Nutzer nicht gefunden.');

  const newPassword = req.body.newPassword || '';
  if (newPassword.length < 6) {
    return renderUsersWithMessage(res, 400, null, 'Neues Passwort muss mindestens 6 Zeichen lang sein.');
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);
  setPasswordStmt.run(passwordHash, targetId);
  renderUsersWithMessage(res, 200, `Passwort für "${target.username}" wurde zurückgesetzt.`, null);
});

module.exports = router;
