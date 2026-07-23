const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');

const router = express.Router();

const insertSession = db.prepare(
  'INSERT INTO solo_sessions (user_id, shots_made, shots_taken) VALUES (?, ?, ?)'
);
const totalsStmt = db.prepare(`
  SELECT COALESCE(SUM(shots_made), 0) AS made, COALESCE(SUM(shots_taken), 0) AS taken
  FROM solo_sessions WHERE user_id = ?
`);
const recentSessionsStmt = db.prepare(`
  SELECT id, shots_made, shots_taken, created_at FROM solo_sessions
  WHERE user_id = ? ORDER BY id DESC LIMIT 20
`);

function renderSolo(req, res, error, status) {
  const totals = totalsStmt.get(req.session.user.id);
  res.status(status || 200).render('solo', {
    title: 'Solo-Training',
    error: error || null,
    totals: {
      made: totals.made,
      taken: totals.taken,
      accuracy: totals.taken > 0 ? (totals.made / totals.taken) * 100 : 0,
    },
    sessions: recentSessionsStmt.all(req.session.user.id).map((s) => ({
      ...s,
      accuracy: s.shots_taken > 0 ? (s.shots_made / s.shots_taken) * 100 : 0,
    })),
  });
}

router.get('/solo', requireAuth, (req, res) => {
  renderSolo(req, res, null);
});

router.post('/solo', requireAuth, csrfProtect, (req, res) => {
  const shotsMade = parseInt(req.body.shotsMade, 10);
  const shotsTaken = parseInt(req.body.shotsTaken, 10);

  if (
    !Number.isInteger(shotsMade) || !Number.isInteger(shotsTaken) ||
    shotsTaken < 1 || shotsMade < 0 || shotsMade > shotsTaken
  ) {
    return renderSolo(req, res, 'Ungültige Sitzung: mindestens 1 Wurf, Treffer dürfen Würfe nicht übersteigen.', 400);
  }

  insertSession.run(req.session.user.id, shotsMade, shotsTaken);
  res.redirect('/solo');
});

module.exports = router;
