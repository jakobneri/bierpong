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

// Built-in Hausregeln-Presets: throwsPerTurn === null means "use the mode
// default" (1 in 1v1, 2 in 2v2, via maxPerTeam), resolved at creation time.
// Everything beyond these two is either "custom" (one-off, per party) or a
// preset a player saved to their own profile (see rule_presets below).
const PARTY_PRESETS = {
  classic: {
    label: 'Classic',
    description: 'Klassische Regeln: reihum ein Wurf pro Wechsel (im 2v2 wirft jede:r einmal, bevor gewechselt wird).',
    throwsPerTurn: null,
    bombEnabled: false,
  },
  keller: {
    label: 'Keller',
    description: 'Unsere Keller-Hausregeln: Standard-Würfe, aber zwei Treffer in Folge einer Seite sprengen die Nachbarbecher mit (Bomben-Regel).',
    throwsPerTurn: null,
    bombEnabled: true,
  },
};

// Resolves mode + form body into { throwsPerTurn, bombEnabled }. Handles
// the two built-ins and "custom" (manual fields); a "saved:<id>" preset
// choice is resolved by the caller first (needs a DB lookup scoped to the
// requesting user), which then skips calling this for that case.
function resolvePartySettings(mode, body) {
  const presetKey = Object.prototype.hasOwnProperty.call(PARTY_PRESETS, body.preset) ? body.preset : 'classic';

  if (body.preset === 'custom') {
    let throwsPerTurn = parseInt(body.throwsPerTurn, 10);
    if (!Number.isInteger(throwsPerTurn) || throwsPerTurn < 1 || throwsPerTurn > 4) {
      throwsPerTurn = maxPerTeam(mode);
    }
    return { throwsPerTurn, bombEnabled: body.bombEnabled === 'on' };
  }

  const preset = PARTY_PRESETS[presetKey];
  return {
    throwsPerTurn: preset.throwsPerTurn === null ? maxPerTeam(mode) : preset.throwsPerTurn,
    bombEnabled: preset.bombEnabled,
  };
}

const listRulePresetsStmt = db.prepare('SELECT * FROM rule_presets WHERE user_id = ? ORDER BY name ASC');
const getRulePresetStmt = db.prepare('SELECT * FROM rule_presets WHERE id = ? AND user_id = ?');
const deleteRulePresetStmt = db.prepare('DELETE FROM rule_presets WHERE id = ? AND user_id = ?');
const upsertRulePresetStmt = db.prepare(`
  INSERT INTO rule_presets (user_id, name, throws_per_turn, bomb_enabled)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(user_id, name) DO UPDATE SET throws_per_turn = excluded.throws_per_turn, bomb_enabled = excluded.bomb_enabled
`);

// Resolves the settings for a party (creation or in-lobby update), including
// the "saved:<id>" case which needs a DB lookup scoped to the requesting
// user (so nobody can apply someone else's saved preset by guessing an id).
function resolveSettingsFromBody(mode, body, userId) {
  if (typeof body.preset === 'string' && body.preset.startsWith('saved:')) {
    const id = parseInt(body.preset.slice('saved:'.length), 10);
    const saved = getRulePresetStmt.get(id, userId);
    if (saved) return { throwsPerTurn: saved.throws_per_turn, bombEnabled: !!saved.bomb_enabled };
  }
  return resolvePartySettings(mode, body);
}

// Optionally saves the resolved custom settings as a reusable preset on the
// user's profile, if they checked "als Preset speichern" and gave it a name.
function maybeSaveRulePreset(userId, body, resolved) {
  if (body.preset !== 'custom' || body.savePreset !== 'on') return;
  const name = (body.presetName || '').trim().slice(0, 40);
  if (!name) return;
  upsertRulePresetStmt.run(userId, name, resolved.throwsPerTurn, resolved.bombEnabled ? 1 : 0);
}

// Best-effort guess at which preset (built-in or saved) matches a party's
// current settings, so an in-lobby settings form can pre-select it instead
// of always defaulting to "classic".
function detectPresetKey(party, savedPresets) {
  const modeDefault = maxPerTeam(party.mode);
  const builtinMatch = Object.entries(PARTY_PRESETS).find(([, preset]) => {
    const expectedThrows = preset.throwsPerTurn === null ? modeDefault : preset.throwsPerTurn;
    return expectedThrows === party.throws_per_turn && preset.bombEnabled === !!party.bomb_enabled;
  });
  if (builtinMatch) return builtinMatch[0];

  const savedMatch = savedPresets.find(
    (sp) => sp.throws_per_turn === party.throws_per_turn && !!sp.bomb_enabled === !!party.bomb_enabled
  );
  if (savedMatch) return `saved:${savedMatch.id}`;

  return 'custom';
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
    rematchCode: party.rematch_code || null,
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
  resolveSettingsFromBody,
  maybeSaveRulePreset,
  detectPresetKey,
  listRulePresetsStmt,
  getRulePresetStmt,
  deleteRulePresetStmt,
  getPartyByCode,
  getPartyById,
  getPartyPlayersStmt,
  buildPartyState,
};
