const db = require('./db');
const { getPartyByCode, getPartyPlayersStmt, buildPartyState, getCupNeighbors } = require('./partyState');

const insertMatch = db.prepare(`
  INSERT INTO matches (mode, created_by, team1_score, team2_score, winner, status, resolved_at, party_id)
  VALUES (?, ?, ?, ?, ?, 'confirmed', datetime('now'), ?)
`);
const insertMatchPlayer = db.prepare('INSERT INTO match_players (match_id, user_id, team) VALUES (?, ?, ?)');
const updateCupsStmt = {
  1: db.prepare('UPDATE parties SET team1_cups = ? WHERE id = ?'),
  2: db.prepare('UPDATE parties SET team2_cups = ? WHERE id = ?'),
};
const updateTurnStmt = db.prepare('UPDATE parties SET current_turn_team = ?, throws_this_turn = ? WHERE id = ?');
const updateStreakStmt = {
  1: db.prepare('UPDATE parties SET team1_streak = ? WHERE id = ?'),
  2: db.prepare('UPDATE parties SET team2_streak = ? WHERE id = ?'),
};
const finishPartyStmt = db.prepare(
  "UPDATE parties SET status = 'finished', finished_at = datetime('now'), match_id = ? WHERE id = ?"
);
const countPartyHitsStmt = db.prepare('SELECT COUNT(*) AS c FROM party_hits WHERE party_id = ?');
const insertPartyHitStmt = db.prepare(`
  INSERT INTO party_hits (party_id, team, cup_index, hit_by_user_id, sequence, is_bomb)
  VALUES (?, ?, ?, ?, ?, ?)
`);

function recordHit(partyId, team, cupIndex, userId, isBomb = false) {
  const sequence = countPartyHitsStmt.get(partyId).c + 1;
  insertPartyHitStmt.run(partyId, team, cupIndex, userId, sequence, isBomb ? 1 : 0);
}

function roomFor(code) {
  return `party:${code}`;
}

function otherTeam(team) {
  return team === 1 ? 2 : 1;
}

// Advances the turn counter for a throw just taken; flips to the other
// team once the party's configured throw allowance is used up.
function advanceTurn(party) {
  const throwsPerTurn = party.throws_per_turn;
  let team = party.current_turn_team;
  let throwsTaken = party.throws_this_turn + 1;
  if (throwsTaken >= throwsPerTurn) {
    team = otherTeam(team);
    throwsTaken = 0;
  }
  updateTurnStmt.run(team, throwsTaken, party.id);
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
      const requester = players.find((p) => p.user_id === sessionUser.id);
      if (!requester) return;
      // Only the team currently on throw may act, and only against the
      // opposing rack - you hit the other side's cups, never your own.
      if (requester.team !== party.current_turn_team) return;
      if (team === requester.team) return;

      const team1Cups = JSON.parse(party.team1_cups);
      const team2Cups = JSON.parse(party.team2_cups);
      const targetCups = team === 1 ? team1Cups : team2Cups;
      if (targetCups[index]) return; // already hit, nothing to do

      const attackerTeam = requester.team;
      targetCups[index] = true;
      recordHit(party.id, team, index, sessionUser.id);

      // Bomben-Regel: trifft eine Seite zwei Mal in Folge (ohne dazwischen
      // danebenzuwerfen), werden alle noch stehenden Nachbarbecher des
      // zuletzt getroffenen Bechers mit vernichtet.
      const streakBefore = attackerTeam === 1 ? party.team1_streak : party.team2_streak;
      let streak = streakBefore + 1;
      const bombedIndexes = [];

      if (party.bomb_enabled && streak >= 2) {
        getCupNeighbors(index).forEach((neighborIndex) => {
          if (!targetCups[neighborIndex]) {
            targetCups[neighborIndex] = true;
            recordHit(party.id, team, neighborIndex, sessionUser.id, true);
            bombedIndexes.push(neighborIndex);
          }
        });
        streak = 0;
      }

      updateCupsStmt[team].run(JSON.stringify(targetCups), party.id);
      updateStreakStmt[attackerTeam].run(streak, party.id);

      const rackCleared = team1Cups.every(Boolean) || team2Cups.every(Boolean);
      if (!rackCleared) {
        advanceTurn(party);
      }

      let updatedParty = getPartyByCode.get(party.code);
      if (rackCleared) {
        finalizeMatch(updatedParty, team1Cups, team2Cups);
        updatedParty = getPartyByCode.get(party.code);
      }

      if (bombedIndexes.length > 0) {
        io.to(roomFor(party.code)).emit('party:bomb', { team, triggerIndex: index, bombedIndexes });
      }
      io.to(roomFor(party.code)).emit('party:state', buildPartyState(updatedParty));
    });

    socket.on('party:miss', ({ code }) => {
      if (!sessionUser || typeof code !== 'string') return;
      const party = getPartyByCode.get(code.toUpperCase());
      if (!party || party.status !== 'active') return;

      const players = getPartyPlayersStmt.all(party.id);
      const requester = players.find((p) => p.user_id === sessionUser.id);
      if (!requester || requester.team !== party.current_turn_team) return;

      updateStreakStmt[requester.team].run(0, party.id);
      advanceTurn(party);

      const updatedParty = getPartyByCode.get(party.code);
      io.to(roomFor(party.code)).emit('party:state', buildPartyState(updatedParty));
    });
  });
};
