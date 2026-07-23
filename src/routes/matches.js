const express = require('express');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');

const router = express.Router();

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');

const insertMatch = db.prepare(`
  INSERT INTO matches (mode, created_by, team1_score, team2_score, winner, status)
  VALUES (?, ?, ?, ?, ?, 'pending')
`);
const insertPlayer = db.prepare('INSERT INTO match_players (match_id, user_id, team) VALUES (?, ?, ?)');

const creatorTeamStmt = db.prepare(`
  SELECT mp.team FROM match_players mp
  JOIN matches m ON m.id = mp.match_id
  WHERE mp.match_id = ? AND mp.user_id = m.created_by
`);
const myTeamStmt = db.prepare('SELECT team FROM match_players WHERE match_id = ? AND user_id = ?');
const matchByIdStmt = db.prepare('SELECT * FROM matches WHERE id = ?');
const confirmMatchStmt = db.prepare(
  "UPDATE matches SET status = 'confirmed', resolved_at = datetime('now') WHERE id = ?"
);
const rejectMatchStmt = db.prepare(
  "UPDATE matches SET status = 'rejected', resolved_at = datetime('now') WHERE id = ?"
);

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

router.get('/matches/new', requireAuth, (req, res) => {
  res.render('new-match', { title: 'Neues Spiel', error: null, form: {} });
});

router.post('/matches/new', requireAuth, csrfProtect, (req, res) => {
  const mode = req.body.mode === '2v2' ? '2v2' : '1v1';
  const myUsername = req.session.user.username;
  const myId = req.session.user.id;

  const fail = (error) => res.status(400).render('new-match', {
    title: 'Neues Spiel',
    error,
    form: req.body,
  });

  const teammateName = mode === '2v2' ? (req.body.teammate || '').trim() : null;
  const opponent1Name = (req.body.opponent1 || '').trim();
  const opponent2Name = mode === '2v2' ? (req.body.opponent2 || '').trim() : null;

  const team1Score = parseInt(req.body.team1_score, 10);
  const team2Score = parseInt(req.body.team2_score, 10);

  if (!opponent1Name || (mode === '2v2' && (!teammateName || !opponent2Name))) {
    return fail('Bitte alle Spieler-Felder ausfüllen.');
  }
  if (!Number.isInteger(team1Score) || !Number.isInteger(team2Score) || team1Score < 0 || team2Score < 0) {
    return fail('Ergebnisse müssen nichtnegative Zahlen sein.');
  }
  if (team1Score === team2Score) {
    return fail('Unentschieden ist beim Bierpong nicht vorgesehen - es muss ein Sieger geben.');
  }

  const usernames = [myUsername, teammateName, opponent1Name, opponent2Name].filter(Boolean);
  const uniqueUsernames = new Set(usernames.map((u) => u.toLowerCase()));
  if (uniqueUsernames.size !== usernames.length) {
    return fail('Jeder Spieler darf nur einmal vorkommen.');
  }

  const team1Users = [{ id: myId }];
  const team2Users = [];

  if (teammateName) {
    const teammate = getUserByUsername.get(teammateName);
    if (!teammate) return fail(`Nutzer "${teammateName}" wurde nicht gefunden.`);
    team1Users.push({ id: teammate.id });
  }

  const opponent1 = getUserByUsername.get(opponent1Name);
  if (!opponent1) return fail(`Nutzer "${opponent1Name}" wurde nicht gefunden.`);
  team2Users.push({ id: opponent1.id });

  if (opponent2Name) {
    const opponent2 = getUserByUsername.get(opponent2Name);
    if (!opponent2) return fail(`Nutzer "${opponent2Name}" wurde nicht gefunden.`);
    team2Users.push({ id: opponent2.id });
  }

  const winner = team1Score > team2Score ? 1 : 2;

  const createMatch = db.transaction(() => {
    const info = insertMatch.run(mode, myId, team1Score, team2Score, winner);
    const matchId = info.lastInsertRowid;
    team1Users.forEach((u) => insertPlayer.run(matchId, u.id, 1));
    team2Users.forEach((u) => insertPlayer.run(matchId, u.id, 2));
    return matchId;
  });

  try {
    createMatch();
  } catch (err) {
    return fail('Spiel konnte nicht gespeichert werden.');
  }

  res.redirect('/matches/pending');
});

router.get('/matches/pending', requireAuth, (req, res) => {
  const myId = req.session.user.id;

  const myMatches = db.prepare(`
    SELECT m.* FROM matches m
    JOIN match_players mp ON mp.match_id = m.id
    WHERE mp.user_id = ? AND m.status = 'pending'
    ORDER BY m.created_at DESC
  `).all(myId);

  const toConfirm = [];
  const awaitingOthers = [];

  for (const match of myMatches) {
    const creatorTeam = creatorTeamStmt.get(match.id).team;
    const myTeam = myTeamStmt.get(match.id, myId).team;
    if (myTeam !== creatorTeam) {
      toConfirm.push(match);
    } else {
      awaitingOthers.push(match);
    }
  }

  res.render('pending', {
    title: 'Ausstehende Spiele',
    toConfirm: withPlayers(toConfirm),
    awaitingOthers: withPlayers(awaitingOthers),
  });
});

router.post('/matches/:id/confirm', requireAuth, csrfProtect, (req, res) => {
  const matchId = parseInt(req.params.id, 10);
  const match = matchByIdStmt.get(matchId);
  if (!match || match.status !== 'pending') return res.redirect('/matches/pending');

  const myTeamRow = myTeamStmt.get(matchId, req.session.user.id);
  const creatorTeam = creatorTeamStmt.get(matchId).team;
  if (!myTeamRow || myTeamRow.team === creatorTeam) return res.redirect('/matches/pending');

  confirmMatchStmt.run(matchId);
  res.redirect('/matches/pending');
});

router.post('/matches/:id/reject', requireAuth, csrfProtect, (req, res) => {
  const matchId = parseInt(req.params.id, 10);
  const match = matchByIdStmt.get(matchId);
  if (!match || match.status !== 'pending') return res.redirect('/matches/pending');

  const myTeamRow = myTeamStmt.get(matchId, req.session.user.id);
  const creatorTeam = creatorTeamStmt.get(matchId).team;
  if (!myTeamRow || myTeamRow.team === creatorTeam) return res.redirect('/matches/pending');

  rejectMatchStmt.run(matchId);
  res.redirect('/matches/pending');
});

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
