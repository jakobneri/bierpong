(function () {
  const root = document.getElementById('party-root');
  if (!root) return;

  const code = root.dataset.code;
  const isPlayer = root.dataset.isPlayer === 'true';
  const myTeam = root.dataset.myTeam ? parseInt(root.dataset.myTeam, 10) : null;
  let currentStatus = root.dataset.status;
  // Seeded from the page's own server-rendered data so the baseline is
  // correct from the very first tick - whether the first update ever
  // arrives via socket or via the polling fallback below (if the socket
  // never connects at all, waiting on a socket-delivered echo to seed
  // this would mean it's never seeded, and every poll looks like "no
  // change yet" forever).
  let lastPlayersSignature = JSON.stringify({
    t1: (root.dataset.team1Ids || '').split(',').filter(Boolean),
    t2: (root.dataset.team2Ids || '').split(',').filter(Boolean),
  });

  const banner = document.getElementById('party-live-banner');
  const turnBanner = document.getElementById('party-turn-banner');
  const missBtn = document.getElementById('party-miss-btn');
  const qrToggleBtn = document.getElementById('qr-toggle-btn');
  const qrBox = document.getElementById('qr-code-box');

  if (qrToggleBtn && qrBox) {
    qrToggleBtn.addEventListener('click', () => {
      qrBox.classList.toggle('hidden');
    });
  }

  const socket = io({ reconnection: true, reconnectionDelay: 1000, reconnectionDelayMax: 5000 });

  function joinRoom() {
    socket.emit('party:join-room', { code });
  }

  socket.on('connect', joinRoom);
  // Belt-and-suspenders: also re-sync whenever the tab regains focus/
  // visibility, in case the connection died silently while backgrounded
  // (common on mobile) without a clean disconnect/reconnect cycle.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') joinRoom();
  });

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function avatarHtml(player, size) {
    if (player.avatarFilename) {
      return `<img class="avatar avatar-${size}" src="/avatars/${encodeURIComponent(player.avatarFilename)}" alt="${escapeHtml(player.username)}" />`;
    }
    return `<span class="avatar avatar-${size} avatar-placeholder">${escapeHtml(player.username.charAt(0).toUpperCase())}</span>`;
  }

  function playersSignature(state) {
    return JSON.stringify({
      t1: state.players.team1.map((p) => String(p.id)),
      t2: state.players.team2.map((p) => String(p.id)),
    });
  }

  function explodeCups(rackSelector, indexes) {
    const rack = root.querySelector(rackSelector);
    if (!rack) return;
    indexes.forEach((index) => {
      const cup = rack.querySelector(`.cup[data-index="${index}"]`);
      if (!cup) return;
      cup.classList.add('bomb-exploding');
      setTimeout(() => cup.classList.remove('bomb-exploding'), 700);
    });
  }

  function updateCups(rackSelector, cups) {
    const rack = root.querySelector(rackSelector);
    if (!rack) return;
    cups.forEach((hit, index) => {
      const cup = rack.querySelector(`.cup[data-index="${index}"]`);
      if (cup) cup.classList.toggle('hit', !!hit);
    });
  }

  function updateTurnUI(state) {
    const isMyTurn = myTeam !== null && state.currentTurnTeam === myTeam;

    [1, 2].forEach((team) => {
      const rack = root.querySelector(`[data-rack="${team}"]`);
      if (!rack) return;
      const isOwnRack = team === myTeam;
      const tappable = isPlayer && isMyTurn && !isOwnRack;
      rack.classList.toggle('rack-locked', !tappable);
      rack.classList.toggle('rack-own', isOwnRack);
    });

    if (turnBanner) {
      const teamNames = state.players[`team${state.currentTurnTeam}`].map((p) => p.username).join(' & ');
      turnBanner.textContent = isMyTurn
        ? `Du bist dran! (Wurf ${state.throwsThisTurn + 1}/${state.throwsPerTurn})`
        : `${teamNames} ist dran (Wurf ${state.throwsThisTurn + 1}/${state.throwsPerTurn})`;
      turnBanner.classList.toggle('my-turn', isMyTurn);
    }

    if (missBtn) {
      missBtn.disabled = !(isPlayer && isMyTurn);
    }
  }

  function showFinishedBanner(state) {
    if (!banner) return;
    const winnerTeam = state.team1Cups.every(Boolean) ? 2 : 1;
    const loserTeam = winnerTeam === 1 ? 2 : 1;
    const winners = state.players[`team${winnerTeam}`];
    const losers = state.players[`team${loserTeam}`];
    const winnerScore = winnerTeam === 1 ? state.team2Cups.filter(Boolean).length : state.team1Cups.filter(Boolean).length;
    const loserScore = winnerTeam === 1 ? state.team1Cups.filter(Boolean).length : state.team2Cups.filter(Boolean).length;

    const confetti = Array.from({ length: 14 }, (_, i) => `<span class="confetti-piece c${i + 1}"></span>`).join('');
    const avatars = winners.map((p) => avatarHtml(p, 'lg')).join('');

    banner.className = '';
    banner.innerHTML = `
      <div class="card victory-card">
        <div class="confetti" aria-hidden="true">${confetti}</div>
        <p class="victory-trophy">🏆</p>
        <div class="winner-avatars">${avatars}</div>
        <h2 class="winner-title">${escapeHtml(winners.map((p) => p.username).join(' & '))} gewinnt!</h2>
        <p class="hint">${winnerScore} : ${loserScore} gegen ${escapeHtml(losers.map((p) => p.username).join(' & '))}</p>
        <p><a href="/matches/history">Im Spielverlauf ansehen</a> &middot; <a href="/stats">Bestenliste</a></p>
      </div>
    `;
  }

  function applyState(state) {
    if (state.status !== currentStatus) {
      if (state.status === 'finished') {
        showFinishedBanner(state);
        currentStatus = state.status;
        return;
      }
      // waiting -> active (or any other transition): simplest correct
      // way to pick up the freshly server-rendered layout for the new phase.
      window.location.reload();
      return;
    }

    if (state.status === 'waiting') {
      // Someone joined/left the lobby - it's fully server-rendered, so a
      // reload is the simplest way to show the updated player list. Only
      // reload if the roster actually changed, since this same function
      // also runs on every poll-fallback tick below.
      const sig = playersSignature(state);
      if (sig !== lastPlayersSignature) {
        window.location.reload();
      }
      return;
    }

    if (state.status === 'active') {
      updateCups('[data-rack="1"]', state.team1Cups);
      updateCups('[data-rack="2"]', state.team2Cups);
      updateTurnUI(state);
    }
  }

  socket.on('party:state', applyState);

  socket.on('party:bomb', ({ team, bombedIndexes }) => {
    if (!bombedIndexes || bombedIndexes.length === 0) return;
    explodeCups(`[data-rack="${team}"]`, bombedIndexes);
    if (banner) {
      banner.textContent = `💣 Bombe! ${bombedIndexes.length} Nachbarbecher explodiert!`;
      banner.classList.remove('hidden');
      setTimeout(() => banner.classList.add('hidden'), 2500);
    }
  });

  socket.on('party:error', (message) => {
    if (banner) {
      banner.textContent = message;
      banner.classList.remove('hidden');
    }
  });

  // Fallback poll: some networks/reverse proxies don't pass WebSocket
  // upgrades through cleanly, silently downgrading or dropping the live
  // channel. Polling every few seconds guarantees updates still arrive
  // (joins, opponent throws) even if the socket connection is stuck.
  setInterval(() => {
    fetch(`/party/${code}/state.json`, { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((state) => { if (state) applyState(state); })
      .catch(() => {});
  }, 4000);

  if (isPlayer) {
    root.addEventListener('click', (event) => {
      const cup = event.target.closest('.cup');
      if (!cup) return;
      const rack = cup.closest('.rack');
      if (rack && rack.classList.contains('rack-locked')) return;
      socket.emit('party:toggle-cup', {
        code,
        team: parseInt(cup.dataset.team, 10),
        index: parseInt(cup.dataset.index, 10),
      });
    });

    if (missBtn) {
      missBtn.addEventListener('click', () => {
        if (missBtn.disabled) return;
        socket.emit('party:miss', { code });
      });
    }
  }
})();
