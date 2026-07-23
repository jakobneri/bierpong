(function () {
  const tracker = document.getElementById('solo-tracker');
  if (!tracker) return;

  const madeEl = document.getElementById('solo-made');
  const takenEl = document.getElementById('solo-taken');
  const pctEl = document.getElementById('solo-pct');
  const hitBtn = document.getElementById('solo-hit');
  const missBtn = document.getElementById('solo-miss');
  const undoBtn = document.getElementById('solo-undo');
  const resetBtn = document.getElementById('solo-reset');
  const saveBtn = document.getElementById('solo-save-btn');
  const shotsMadeInput = document.getElementById('solo-shots-made');
  const shotsTakenInput = document.getElementById('solo-shots-taken');

  const history = []; // stack of 'hit' | 'miss'
  let made = 0;
  let taken = 0;

  function render() {
    madeEl.textContent = made;
    takenEl.textContent = taken;
    pctEl.textContent = `(${taken > 0 ? ((made / taken) * 100).toFixed(0) : 0}%)`;
    shotsMadeInput.value = made;
    shotsTakenInput.value = taken;
    saveBtn.disabled = taken === 0;
    undoBtn.disabled = history.length === 0;
  }

  hitBtn.addEventListener('click', () => {
    history.push('hit');
    made += 1;
    taken += 1;
    render();
  });

  missBtn.addEventListener('click', () => {
    history.push('miss');
    taken += 1;
    render();
  });

  undoBtn.addEventListener('click', () => {
    const last = history.pop();
    if (!last) return;
    if (last === 'hit') made -= 1;
    taken -= 1;
    render();
  });

  resetBtn.addEventListener('click', () => {
    history.length = 0;
    made = 0;
    taken = 0;
    render();
  });

  render();
})();
