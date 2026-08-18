(function () {
  const form = document.getElementById('delete-account-form');
  if (!form) return;

  form.addEventListener('submit', (event) => {
    const confirmed = window.confirm(
      'Account wirklich unwiderruflich löschen? Benutzername, Profilbild und Zugangsdaten werden entfernt und können nicht wiederhergestellt werden.'
    );
    if (!confirmed) event.preventDefault();
  });
})();
