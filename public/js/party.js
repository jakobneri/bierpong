(function () {
  const root = document.getElementById('party-root');
  if (!root) return;

  const code = root.dataset.code;
  const isPlayer = root.dataset.isPlayer === 'true';
  let currentStatus = root.dataset.status;

  const banner = document.getElementById('party-live-banner');

  const socket = io();

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

    if (state.status === 'active') {
      updateCups('[data-rack="1"]', state.team1Cups);
      updateCups('[data-rack="2"]', state.team2Cups);
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
      socket.emit('party:toggle-cup', {
        code,
        team: parseInt(cup.dataset.team, 10),
        index: parseInt(cup.dataset.index, 10),
      });
    });
  }
})();
