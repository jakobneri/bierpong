const db = require('./db');

const RACK_SIZE = 10;

function maxPerTeam(mode) {
  return mode === '2v2' ? 2 : 1;
}

function emptyRack() {
  return JSON.stringify(new Array(RACK_SIZE).fill(false));
}

const getPartyByCode = db.prepare('SELECT * FROM parties WHERE code = ?');
const getPartyById = db.prepare('SELECT * FROM parties WHERE id = ?');
const getPartyPlayersStmt = db.prepare(`
  SELECT pp.team, pp.user_id, u.username FROM party_players pp
  JOIN users u ON u.id = pp.user_id
  WHERE pp.party_id = ? ORDER BY pp.team, pp.joined_at
`);

function buildPartyState(party) {
  const players = getPartyPlayersStmt.all(party.id);
  return {
    code: party.code,
    mode: party.mode,
    status: party.status,
    rackSize: party.rack_size,
    team1Cups: JSON.parse(party.team1_cups),
    team2Cups: JSON.parse(party.team2_cups),
    matchId: party.match_id,
    maxPerTeam: maxPerTeam(party.mode),
    players: {
      team1: players.filter((p) => p.team === 1).map((p) => ({ id: p.user_id, username: p.username })),
      team2: players.filter((p) => p.team === 2).map((p) => ({ id: p.user_id, username: p.username })),
    },
  };
}

module.exports = {
  RACK_SIZE,
  maxPerTeam,
  emptyRack,
  getPartyByCode,
  getPartyById,
  getPartyPlayersStmt,
  buildPartyState,
};
