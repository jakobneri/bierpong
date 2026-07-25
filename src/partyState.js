const db = require('./db');

const RACK_SIZE = 10;
const ROW_SIZES = [4, 3, 2, 1]; // classic 4-3-2-1 triangle, index 0 = base row
const ROW_STARTS = [0, 4, 7, 9];

function maxPerTeam(mode) {
  return mode === '2v2' ? 2 : 1;
}

function emptyRack() {
  return JSON.stringify(new Array(RACK_SIZE).fill(false));
}

function indexToRowCol(index) {
  for (let r = ROW_SIZES.length - 1; r >= 0; r--) {
    if (index >= ROW_STARTS[r]) return [r, index - ROW_STARTS[r]];
  }
  return [0, index];
}

function rowColToIndex(row, col) {
  if (row < 0 || row >= ROW_SIZES.length) return null;
  if (col < 0 || col >= ROW_SIZES[row]) return null;
  return ROW_STARTS[row] + col;
}

// Cups touching a given position in the triangle: same row (left/right),
// the row with one fewer cup (apex-ward), and the row with one more cup
// (base-ward) - the standard adjacency for a triangular rack.
function getCupNeighbors(index) {
  const [r, c] = indexToRowCol(index);
  const candidates = [
    [r, c - 1], [r, c + 1],
    [r + 1, c - 1], [r + 1, c],
    [r - 1, c], [r - 1, c + 1],
  ];
  const seen = new Set();
  const result = [];
  candidates.forEach(([rr, cc]) => {
    const idx = rowColToIndex(rr, cc);
    if (idx !== null && idx !== index && !seen.has(idx)) {
      seen.add(idx);
      result.push(idx);
    }
  });
  return result;
}

// Hausregeln-Presets: throwsPerTurn === null means "use the mode default"
// (1 in 1v1, 2 in 2v2, via maxPerTeam), resolved at creation time.
const PARTY_PRESETS = {
  standard: {
    label: 'Standard',
    description: 'Klassische Regeln: reihum ein Wurf pro Wechsel (im 2v2 wirft jede:r einmal, bevor gewechselt wird).',
    throwsPerTurn: null,
    bombEnabled: false,
  },
  doppelwurf: {
    label: 'Doppelwurf',
    description: 'Jede Seite wirft zweimal in Folge, bevor die andere Seite dran ist - auch 1 gegen 1.',
    throwsPerTurn: 2,
    bombEnabled: false,
  },
  bomben: {
    label: 'Bomben-Modus',
    description: 'Standard-Würfe, aber zwei Treffer in Folge einer Seite lassen alle Nachbarbecher mit explodieren.',
    throwsPerTurn: null,
    bombEnabled: true,
  },
  chaos: {
    label: 'Chaos',
    description: 'Doppelwurf und Bomben-Modus kombiniert - für die Profis unter euch.',
    throwsPerTurn: 2,
    bombEnabled: true,
  },
  custom: {
    label: 'Benutzerdefiniert',
    description: 'Wurfanzahl und Bomben-Regel selbst festlegen.',
    throwsPerTurn: null,
    bombEnabled: false,
  },
};

function resolvePartySettings(mode, body) {
  const presetKey = Object.prototype.hasOwnProperty.call(PARTY_PRESETS, body.preset) ? body.preset : 'standard';

  if (presetKey === 'custom') {
    let throwsPerTurn = parseInt(body.throwsPerTurn, 10);
    if (!Number.isInteger(throwsPerTurn) || throwsPerTurn < 1 || throwsPerTurn > 4) {
      throwsPerTurn = maxPerTeam(mode);
    }
    return { preset: presetKey, throwsPerTurn, bombEnabled: body.bombEnabled === 'on' };
  }

  const preset = PARTY_PRESETS[presetKey];
  return {
    preset: presetKey,
    throwsPerTurn: preset.throwsPerTurn === null ? maxPerTeam(mode) : preset.throwsPerTurn,
    bombEnabled: preset.bombEnabled,
  };
}

const getPartyByCode = db.prepare('SELECT * FROM parties WHERE code = ?');
const getPartyById = db.prepare('SELECT * FROM parties WHERE id = ?');
const getPartyPlayersStmt = db.prepare(`
  SELECT pp.team, pp.user_id, u.username, u.avatar_filename FROM party_players pp
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
    currentTurnTeam: party.current_turn_team,
    throwsThisTurn: party.throws_this_turn,
    throwsPerTurn: party.throws_per_turn,
    bombEnabled: !!party.bomb_enabled,
    players: {
      team1: players.filter((p) => p.team === 1).map((p) => ({ id: p.user_id, username: p.username, avatarFilename: p.avatar_filename })),
      team2: players.filter((p) => p.team === 2).map((p) => ({ id: p.user_id, username: p.username, avatarFilename: p.avatar_filename })),
    },
  };
}

module.exports = {
  RACK_SIZE,
  maxPerTeam,
  emptyRack,
  getCupNeighbors,
  PARTY_PRESETS,
  resolvePartySettings,
  getPartyByCode,
  getPartyById,
  getPartyPlayersStmt,
  buildPartyState,
};
