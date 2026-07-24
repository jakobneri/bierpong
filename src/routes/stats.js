const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

const leaderboardStmt = db.prepare(`
  SELECT
    u.id,
    u.username,
    u.avatar_filename,
    COUNT(*) AS games,
    SUM(CASE WHEN mp.team = m.winner THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN mp.team = m.winner THEN 0 ELSE 1 END) AS losses,
    SUM(CASE WHEN mp.team = 1 THEN m.team1_score ELSE m.team2_score END) AS cups_for,
    SUM(CASE WHEN mp.team = 1 THEN m.team2_score ELSE m.team1_score END) AS cups_against
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id AND m.status = 'confirmed'
  JOIN users u ON u.id = mp.user_id AND u.is_management = 0
  GROUP BY u.id
  ORDER BY (CAST(wins AS REAL) / games) DESC, games DESC, u.username ASC
`);

// LEFT JOIN so a user with zero confirmed games still gets a row (0s)
// instead of a 404 - the profile page is also where you manage your own
// avatar, so it needs to be reachable before you've ever played.
const userStatsStmt = db.prepare(`
  SELECT
    u.id,
    u.username,
    u.avatar_filename,
    COUNT(m.id) AS games,
    COALESCE(SUM(CASE WHEN m.id IS NULL THEN 0 WHEN mp.team = m.winner THEN 1 ELSE 0 END), 0) AS wins,
    COALESCE(SUM(CASE WHEN m.id IS NULL THEN 0 WHEN mp.team = m.winner THEN 0 ELSE 1 END), 0) AS losses,
    COALESCE(SUM(CASE WHEN mp.team = 1 THEN m.team1_score ELSE m.team2_score END), 0) AS cups_for,
    COALESCE(SUM(CASE WHEN mp.team = 1 THEN m.team2_score ELSE m.team1_score END), 0) AS cups_against
  FROM users u
  LEFT JOIN match_players mp ON mp.user_id = u.id
  LEFT JOIN matches m ON m.id = mp.match_id AND m.status = 'confirmed'
  WHERE u.username = ?
  GROUP BY u.id
`);

const userHistoryStmt = db.prepare(`
  SELECT m.* FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  JOIN users u ON u.id = mp.user_id
  WHERE u.username = ? AND m.status = 'confirmed'
  ORDER BY m.resolved_at DESC
  LIMIT 100
`);

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

function withWinRate(row) {
  return { ...row, winRate: row.games > 0 ? (row.wins / row.games) * 100 : 0 };
}

router.get('/stats', requireAuth, (req, res) => {
  const rows = leaderboardStmt.all().map(withWinRate);
  res.render('leaderboard', { title: 'Bestenliste', rows });
});

router.get('/stats/:username', requireAuth, (req, res) => {
  const stats = userStatsStmt.get(req.params.username);
  if (!stats) {
    return res.status(404).render('error', {
      title: 'Nicht gefunden',
      message: 'Diesen Nutzer gibt es nicht.',
    });
  }
  const history = userHistoryStmt.all(req.params.username).map((m) => ({
    ...m,
    players: loadPlayers(m.id),
  }));

  const avatarError = req.session.avatarError || null;
  delete req.session.avatarError;

  res.render('profile', {
    title: `Statistik: ${stats.username}`,
    stats: withWinRate(stats),
    history,
    isOwnProfile: stats.id === req.session.user.id,
    avatarError,
  });
});

module.exports = router;
