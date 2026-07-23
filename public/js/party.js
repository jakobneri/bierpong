(function () {
  const root = document.getElementById('party-root');
  if (!root) return;

  const code = root.dataset.code;
  const isPlayer = root.dataset.isPlayer === 'true';
  const myTeam = root.dataset.myTeam ? parseInt(root.dataset.myTeam, 10) : null;
  let currentStatus = root.dataset.status;

  const banner = document.getElementById('party-live-banner');
  const turnBanner = document.getElementById('party-turn-banner');
  const missBtn = document.getElementById('party-miss-btn');

  const socket = io();
  let receivedInitialState = false;

  socket.on('connect', () => {
    socket.emit('party:join-room', { code });
  });

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
    const team1Names = state.players.team1.map((p) => p.username).join(' & ');
    const team2Names = state.players.team2.map((p) => p.username).join(' & ');
    const team1Score = state.team2Cups.filter(Boolean).length;
    const team2Score = state.team1Cups.filter(Boolean).length;
    banner.innerHTML =
      `<strong>Spiel beendet!</strong> ${team1Names} ${team1Score} : ${team2Score} ${team2Names} ` +
      '&mdash; <a href="/matches/history">Verlauf</a> &middot; <a href="/stats">Bestenliste</a>';
    banner.classList.remove('hidden');
  }

  socket.on('party:state', (state) => {
    // The first event is just the room-join echo of the state already
    // baked into this page load - sync silently, don't reload off it.
    if (!receivedInitialState) {
      receivedInitialState = true;
      currentStatus = state.status;
      if (state.status === 'active') {
        updateCups('[data-rack="1"]', state.team1Cups);
        updateCups('[data-rack="2"]', state.team2Cups);
        updateTurnUI(state);
      }
      return;
    }

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
      // reload is the simplest way to show the updated player list.
      window.location.reload();
      return;
    }

    if (state.status === 'active') {
      updateCups('[data-rack="1"]', state.team1Cups);
      updateCups('[data-rack="2"]', state.team2Cups);
      updateTurnUI(state);
    }
  });

  socket.on('party:error', (message) => {
    if (banner) {
      banner.textContent = message;
      banner.classList.remove('hidden');
    }
  });

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
