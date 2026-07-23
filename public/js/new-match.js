function toggleMode() {
  const is2v2 = document.querySelector('input[name="mode"]:checked').value === '2v2';
  document.getElementById('teammate-field').classList.toggle('hidden', !is2v2);
  document.getElementById('opponent2-field').classList.toggle('hidden', !is2v2);
  document.querySelector('input[name="teammate"]').required = is2v2;
  document.querySelector('input[name="opponent2"]').required = is2v2;
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('input[name="mode"]').forEach((el) => {
    el.addEventListener('change', toggleMode);
  });
  toggleMode();
});
