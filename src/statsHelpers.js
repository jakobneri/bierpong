const db = require('./db');
const { RACK_SIZE } = require('./partyState');

// Bomb-destroyed cups weren't actually aimed at, so they're excluded from
// these skill-based stats (is_bomb = 0) to avoid skewing them.
const personalHeatmapStmt = db.prepare(`
  SELECT cup_index, COUNT(*) AS hits FROM party_hits WHERE hit_by_user_id = ? AND is_bomb = 0 GROUP BY cup_index
`);
const globalHeatmapStmt = db.prepare(`
  SELECT cup_index, COUNT(*) AS hits FROM party_hits WHERE is_bomb = 0 GROUP BY cup_index
`);
const firstHitsStmt = db.prepare(`
  SELECT ph.cup_index
  FROM party_hits ph
  WHERE ph.hit_by_user_id = ?
    AND ph.is_bomb = 0
    AND ph.sequence = (
      SELECT MIN(ph2.sequence) FROM party_hits ph2
      WHERE ph2.party_id = ph.party_id AND ph2.hit_by_user_id = ph.hit_by_user_id AND ph2.is_bomb = 0
    )
`);

function rowsToTotals(rows) {
  const totals = new Array(RACK_SIZE).fill(0);
  rows.forEach((r) => { if (r.cup_index >= 0 && r.cup_index < RACK_SIZE) totals[r.cup_index] = r.hits; });
  return totals;
}

function personalCupHeatmap(userId) {
  return rowsToTotals(personalHeatmapStmt.all(userId));
}

function globalCupHeatmap() {
  return rowsToTotals(globalHeatmapStmt.all());
}

// For each game a user played in, which cup position was THEIR own first
// successful hit - a rough "opening move" tendency.
function firstHitDistribution(userId) {
  const rows = firstHitsStmt.all(userId);
  const totals = new Array(RACK_SIZE).fill(0);
  rows.forEach((r) => { if (r.cup_index >= 0 && r.cup_index < RACK_SIZE) totals[r.cup_index] += 1; });
  const totalFirstHits = rows.length;
  let topIndex = null;
  let topCount = 0;
  totals.forEach((count, index) => {
    if (count > topCount) { topCount = count; topIndex = index; }
  });
  return { totals, totalFirstHits, topIndex, topCount };
}

module.exports = { personalCupHeatmap, globalCupHeatmap, firstHitDistribution };
