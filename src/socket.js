const db = require('./db');
const { getPartyByCode, getPartyPlayersStmt, buildPartyState } = require('./partyState');

const insertMatch = db.prepare(`
  INSERT INTO matches (mode, created_by, team1_score, team2_score, winner, status, resolved_at, party_id)
  VALUES (?, ?, ?, ?, ?, 'confirmed', datetime('now'), ?)
`);
const insertMatchPlayer = db.prepare('INSERT INTO match_players (match_id, user_id, team) VALUES (?, ?, ?)');
const updateCupsStmt = {
  1: db.prepare('UPDATE parties SET team1_cups = ? WHERE id = ?'),
  2: db.prepare('UPDATE parties SET team2_cups = ? WHERE id = ?'),
};
const finishPartyStmt = db.prepare(
  "UPDATE parties SET status = 'finished', finished_at = datetime('now'), match_id = ? WHERE id = ?"
);

function roomFor(code) {
  return `party:${code}`;
}

function finalizeMatch(party, team1Cups, team2Cups) {
  const team1Score = team2Cups.filter(Boolean).length;
  const team2Score = team1Cups.filter(Boolean).length;
  const winner = team1Cups.every(Boolean) ? 2 : 1;
  const players = getPartyPlayersStmt.all(party.id);

  const run = db.transaction(() => {
    const info = insertMatch.run(party.mode, party.created_by, team1Score, team2Score, winner, party.id);
    const matchId = info.lastInsertRowid;
    players.forEach((p) => insertMatchPlayer.run(matchId, p.user_id, p.team));
    finishPartyStmt.run(matchId, party.id);
    return matchId;
  });

  return run();
}

module.exports = function initSocket(io) {
  io.on('connection', (socket) => {
    const sessionUser = socket.request.session && socket.request.session.user;

    socket.on('party:join-room', ({ code }) => {
      if (!sessionUser || typeof code !== 'string') return;
      const party = getPartyByCode.get(code.toUpperCase());
      if (!party) {
        socket.emit('party:error', 'Party nicht gefunden.');
        return;
      }
      socket.join(roomFor(party.code));
      socket.emit('party:state', buildPartyState(party));
    });

    socket.on('party:toggle-cup', ({ code, team, index }) => {
      if (!sessionUser || typeof code !== 'string') return;
      const party = getPartyByCode.get(code.toUpperCase());
      if (!party || party.status !== 'active') return;
      if (team !== 1 && team !== 2) return;
      if (!Number.isInteger(index) || index < 0 || index >= party.rack_size) return;

      const players = getPartyPlayersStmt.all(party.id);
      const isPlayer = players.some((p) => p.user_id === sessionUser.id);
      if (!isPlayer) return;

      const team1Cups = JSON.parse(party.team1_cups);
      const team2Cups = JSON.parse(party.team2_cups);
      const targetCups = team === 1 ? team1Cups : team2Cups;
      targetCups[index] = !targetCups[index];
      updateCupsStmt[team].run(JSON.stringify(targetCups), party.id);

      let updatedParty = getPartyByCode.get(party.code);

      if (team1Cups.every(Boolean) || team2Cups.every(Boolean)) {
        finalizeMatch(updatedParty, team1Cups, team2Cups);
        updatedParty = getPartyByCode.get(party.code);
      }

      io.to(roomFor(party.code)).emit('party:state', buildPartyState(updatedParty));
    });
  });
};
