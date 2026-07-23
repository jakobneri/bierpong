(function () {
  const tracker = document.getElementById('solo-tracker');
  if (!tracker) return;

  const rackSize = parseInt(tracker.dataset.rackSize, 10) || 10;
  const rack = document.getElementById('solo-rack');
  const madeEl = document.getElementById('solo-made');
  const takenEl = document.getElementById('solo-taken');
  const pctEl = document.getElementById('solo-pct');
  const missBtn = document.getElementById('solo-miss');
  const undoMissBtn = document.getElementById('solo-undo-miss');
  const newRackBtn = document.getElementById('solo-new-rack');
  const resetBtn = document.getElementById('solo-reset');
  const saveBtn = document.getElementById('solo-save-btn');
  const shotsMadeInput = document.getElementById('solo-shots-made');
  const shotsTakenInput = document.getElementById('solo-shots-taken');
  const cupHitsInput = document.getElementById('solo-cup-hits');

  const cupHits = new Array(rackSize).fill(0); // cumulative, survives "Neues Rack"
  const hitState = new Array(rackSize).fill(false); // current rack's visual state
  let misses = 0;

  function render() {
    const made = cupHits.reduce((a, b) => a + b, 0);
    const taken = made + misses;

    madeEl.textContent = made;
    takenEl.textContent = taken;
    pctEl.textContent = `(${taken > 0 ? ((made / taken) * 100).toFixed(0) : 0}%)`;

    rack.querySelectorAll('.cup').forEach((cup) => {
      const index = parseInt(cup.dataset.index, 10);
      cup.classList.toggle('hit', hitState[index]);
    });

    shotsMadeInput.value = made;
    shotsTakenInput.value = taken;
    cupHitsInput.value = JSON.stringify(cupHits);
    saveBtn.disabled = taken === 0;
    undoMissBtn.disabled = misses === 0;
  }

  rack.addEventListener('click', (event) => {
    const cup = event.target.closest('.cup');
    if (!cup) return;
    const index = parseInt(cup.dataset.index, 10);
    if (hitState[index]) {
      hitState[index] = false;
      cupHits[index] -= 1;
    } else {
      hitState[index] = true;
      cupHits[index] += 1;
    }
    render();
  });

  missBtn.addEventListener('click', () => {
    misses += 1;
    render();
  });

  undoMissBtn.addEventListener('click', () => {
    if (misses > 0) misses -= 1;
    render();
  });

  newRackBtn.addEventListener('click', () => {
    hitState.fill(false);
    render();
  });

  resetBtn.addEventListener('click', () => {
    cupHits.fill(0);
    hitState.fill(false);
    misses = 0;
    render();
  });

  render();
})();
