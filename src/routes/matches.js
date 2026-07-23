const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const matchPlayersStmt = db.prepare(`
  SELECT mp.team, u.username
  FROM match_players mp
  JOIN users u ON u.id = mp.user_id
  WHERE mp.match_id = ?
  ORDER BY mp.team, u.username
`);

function loadPlayers(matchId) {
  const rows = matchPlayersStmt.all(matchId);
  return {
    team1: rows.filter((r) => r.team === 1).map((r) => r.username),
    team2: rows.filter((r) => r.team === 2).map((r) => r.username),
  };
}

function withPlayers(matches) {
  return matches.map((m) => ({ ...m, players: loadPlayers(m.id) }));
}

router.get('/matches/history', requireAuth, (req, res) => {
  const myId = req.session.user.id;
  const matches = db.prepare(`
    SELECT m.* FROM matches m
    JOIN match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = ? AND m.status = 'confirmed'
    ORDER BY m.resolved_at DESC
    LIMIT 100
  `).all(myId);

  res.render('history', {
    title: 'Spielverlauf',
    matches: withPlayers(matches),
    myUsername: req.session.user.username,
  });
});

module.exports = router;
