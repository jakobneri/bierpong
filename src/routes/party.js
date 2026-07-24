const express = require('express');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('../db');
const { requireAuth, blockManagement } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');
const {
  RACK_SIZE,
  maxPerTeam,
  emptyRack,
  getPartyByCode,
  getPartyPlayersStmt,
  buildPartyState,
} = require('../partyState');

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L

function generateCode() {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

function openTeamsFor(party, players) {
  const need = maxPerTeam(party.mode);
  const team1Count = players.filter((p) => p.team === 1).length;
  const team2Count = players.filter((p) => p.team === 2).length;
  const open = [];
  if (team1Count < need) open.push(1);
  if (team2Count < need) open.push(2);
  return open;
}

const insertParty = db.prepare(`
  INSERT INTO parties (code, mode, created_by, rack_size, team1_cups, team2_cups)
  VALUES (?, ?, ?, ?, ?, ?)
`);
const insertPartyPlayer = db.prepare('INSERT INTO party_players (party_id, user_id, team) VALUES (?, ?, ?)');
const startPartyStmt = db.prepare("UPDATE parties SET status = 'active', started_at = datetime('now') WHERE id = ?");

module.exports = function createPartyRouter(io) {
  const router = express.Router();

  router.get('/party/new', requireAuth, blockManagement, (req, res) => {
    res.render('party/new', { title: 'Live-Party starten', error: null });
  });

  router.post('/party/new', requireAuth, blockManagement, csrfProtect, (req, res) => {
    const mode = req.body.mode === '2v2' ? '2v2' : '1v1';

    const createParty = db.transaction(() => {
      let code;
      for (let attempt = 0; attempt < 10; attempt++) {
        code = generateCode();
        if (!getPartyByCode.get(code)) break;
      }
      const info = insertParty.run(code, mode, req.session.user.id, RACK_SIZE, emptyRack(), emptyRack());
      insertPartyPlayer.run(info.lastInsertRowid, req.session.user.id, 1);
      return code;
    });

    let code;
    try {
      code = createParty();
    } catch (err) {
      return res.status(400).render('party/new', { title: 'Live-Party starten', error: 'Party konnte nicht erstellt werden, bitte erneut versuchen.' });
    }

    res.redirect(`/party/${code}`);
  });

  router.get('/party/join', requireAuth, blockManagement, (req, res) => {
    res.render('party/join', { title: 'Party beitreten', error: null });
  });

  router.post('/party/join', requireAuth, blockManagement, csrfProtect, (req, res) => {
    const code = (req.body.code || '').trim().toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) {
      return res.status(404).render('party/join', { title: 'Party beitreten', error: 'Party-Code nicht gefunden.' });
    }
    res.redirect(`/party/${party.code}`);
  });

  router.get('/party/:code', requireAuth, (req, res) => {
    const code = req.params.code.toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) {
      return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Party gibt es nicht (mehr).' });
    }
    const state = buildPartyState(party);
    const myId = req.session.user.id;
    const onTeam1 = state.players.team1.some((p) => p.id === myId);
    const onTeam2 = state.players.team2.some((p) => p.id === myId);
    const isPlayer = onTeam1 || onTeam2;
    const myTeam = onTeam1 ? 1 : (onTeam2 ? 2 : null);
    const players = getPartyPlayersStmt.all(party.id);

    res.render('party/board', {
      title: `Party ${party.code}`,
      state,
      isPlayer,
      myTeam,
      isCreator: party.created_by === myId,
      openTeams: openTeamsFor(party, players),
      joinUrl: `${req.protocol}://${req.get('host')}/party/${party.code}`,
    });
  });

  router.get('/party/:code/state.json', requireAuth, (req, res) => {
    const code = req.params.code.toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) return res.status(404).json({ error: 'not found' });
    res.set('Cache-Control', 'no-store').json(buildPartyState(party));
  });

  router.get('/party/:code/qr.svg', requireAuth, async (req, res) => {
    const code = req.params.code.toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) return res.status(404).end();

    const url = `${req.protocol}://${req.get('host')}/party/${code}`;
    try {
      const svg = await QRCode.toString(url, {
        type: 'svg',
        margin: 1,
        color: { dark: '#241a12', light: '#f6efe2' },
      });
      res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
    } catch (err) {
      res.status(500).end();
    }
  });

  router.post('/party/:code/join', requireAuth, blockManagement, csrfProtect, (req, res) => {
    const code = req.params.code.toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Party gibt es nicht (mehr).' });

    if (party.status !== 'waiting') {
      return res.redirect(`/party/${code}`);
    }

    const players = getPartyPlayersStmt.all(party.id);
    const myId = req.session.user.id;
    const alreadyIn = players.some((p) => p.user_id === myId);

    if (!alreadyIn) {
      const openTeams = openTeamsFor(party, players);
      if (openTeams.length === 0) {
        return res.status(400).render('error', { title: 'Team voll', message: 'Diese Party ist bereits voll.' });
      }

      // When only one team still has room, there's no real choice to make -
      // assign it automatically instead of asking. Only trust the client's
      // chosen team when both are actually open.
      let team;
      if (openTeams.length === 1) {
        team = openTeams[0];
      } else {
        team = req.body.team === '2' ? 2 : 1;
        if (!openTeams.includes(team)) {
          return res.status(400).render('error', { title: 'Team voll', message: 'Dieses Team ist bereits voll.' });
        }
      }

      insertPartyPlayer.run(party.id, myId, team);

      const updated = buildPartyState(getPartyByCode.get(code));
      io.to(`party:${code}`).emit('party:state', updated);
    }

    res.redirect(`/party/${code}`);
  });

  router.post('/party/:code/start', requireAuth, csrfProtect, (req, res) => {
    const code = req.params.code.toUpperCase();
    const party = getPartyByCode.get(code);
    if (!party) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Party gibt es nicht (mehr).' });

    if (party.created_by !== req.session.user.id || party.status !== 'waiting') {
      return res.redirect(`/party/${code}`);
    }

    const players = getPartyPlayersStmt.all(party.id);
    const need = maxPerTeam(party.mode);
    const team1Count = players.filter((p) => p.team === 1).length;
    const team2Count = players.filter((p) => p.team === 2).length;
    if (team1Count < need || team2Count < need) {
      return res.redirect(`/party/${code}`);
    }

    startPartyStmt.run(party.id);
    const updated = buildPartyState(getPartyByCode.get(code));
    io.to(`party:${code}`).emit('party:state', updated);

    res.redirect(`/party/${code}`);
  });

  return router;
};
