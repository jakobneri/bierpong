(function () {
  const options = document.querySelectorAll('[data-preset-option]');
  const customFieldset = document.getElementById('custom-settings-fieldset');
  if (!options.length || !customFieldset) return;

  function sync() {
    const selected = document.querySelector('[data-preset-option]:checked');
    customFieldset.classList.toggle('hidden', !selected || selected.value !== 'custom');
  }

  options.forEach((opt) => opt.addEventListener('change', sync));
  sync();
})();
