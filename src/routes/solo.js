const express = require('express');
const db = require('../db');
const { requireAuth, blockManagement } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');
const { RACK_SIZE } = require('../partyState');

const router = express.Router();

const insertSession = db.prepare(
  'INSERT INTO solo_sessions (user_id, shots_made, shots_taken, cup_hits) VALUES (?, ?, ?, ?)'
);
const totalsStmt = db.prepare(`
  SELECT COALESCE(SUM(shots_made), 0) AS made, COALESCE(SUM(shots_taken), 0) AS taken
  FROM solo_sessions WHERE user_id = ?
`);
const recentSessionsStmt = db.prepare(`
  SELECT id, shots_made, shots_taken, created_at FROM solo_sessions
  WHERE user_id = ? ORDER BY id DESC LIMIT 20
`);
const allCupHitsStmt = db.prepare('SELECT cup_hits FROM solo_sessions WHERE user_id = ?');

function computeCupTotals(userId) {
  const totals = new Array(RACK_SIZE).fill(0);
  for (const row of allCupHitsStmt.all(userId)) {
    let hits;
    try {
      hits = JSON.parse(row.cup_hits);
    } catch (err) {
      continue;
    }
    if (!Array.isArray(hits)) continue;
    hits.forEach((count, index) => {
      if (index < RACK_SIZE) totals[index] += Number(count) || 0;
    });
  }
  return totals;
}

function renderSolo(req, res, error, status) {
  const totals = totalsStmt.get(req.session.user.id);
  const cupTotals = computeCupTotals(req.session.user.id);
  res.status(status || 200).render('solo', {
    title: 'Solo-Training',
    error: error || null,
    rackSize: RACK_SIZE,
    totals: {
      made: totals.made,
      taken: totals.taken,
      accuracy: totals.taken > 0 ? (totals.made / totals.taken) * 100 : 0,
    },
    cupTotals,
    cupTotalsMax: Math.max(1, ...cupTotals),
    sessions: recentSessionsStmt.all(req.session.user.id).map((s) => ({
      ...s,
      accuracy: s.shots_taken > 0 ? (s.shots_made / s.shots_taken) * 100 : 0,
    })),
  });
}

router.get('/solo', requireAuth, blockManagement, (req, res) => {
  renderSolo(req, res, null);
});

router.post('/solo', requireAuth, blockManagement, csrfProtect, (req, res) => {
  const shotsMade = parseInt(req.body.shotsMade, 10);
  const shotsTaken = parseInt(req.body.shotsTaken, 10);

  let cupHits;
  try {
    cupHits = JSON.parse(req.body.cupHits || '[]');
  } catch (err) {
    cupHits = null;
  }

  const cupHitsValid = Array.isArray(cupHits) &&
    cupHits.length === RACK_SIZE &&
    cupHits.every((n) => Number.isInteger(n) && n >= 0);

  if (
    !Number.isInteger(shotsMade) || !Number.isInteger(shotsTaken) ||
    shotsTaken < 1 || shotsMade < 0 || shotsMade > shotsTaken ||
    !cupHitsValid || cupHits.reduce((a, b) => a + b, 0) !== shotsMade
  ) {
    return renderSolo(req, res, 'Ungültige Sitzung: Angaben passen nicht zusammen, bitte erneut versuchen.', 400);
  }

  insertSession.run(req.session.user.id, shotsMade, shotsTaken, JSON.stringify(cupHits));
  res.redirect('/solo');
});

module.exports = router;
