(function () {
  const options = document.querySelectorAll('[data-preset-option]');
  const customFieldset = document.getElementById('custom-settings-fieldset');
  const savePresetToggle = document.querySelector('[data-save-preset-toggle]');
  const presetNameField = document.getElementById('preset-name-field');

  function syncPreset() {
    if (!options.length || !customFieldset) return;
    const selected = document.querySelector('[data-preset-option]:checked');
    customFieldset.classList.toggle('hidden', !selected || selected.value !== 'custom');
  }

  function syncPresetName() {
    if (!savePresetToggle || !presetNameField) return;
    presetNameField.classList.toggle('hidden', !savePresetToggle.checked);
  }

  options.forEach((opt) => opt.addEventListener('change', syncPreset));
  if (savePresetToggle) savePresetToggle.addEventListener('change', syncPresetName);
  syncPreset();
  syncPresetName();
})();
