const crypto = require('crypto');

function csrfToken(req, res, next) {
  if (!req.session.csrfToken) {
    req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
}

function csrfProtect(req, res, next) {
  const tokenFromForm = req.body && req.body._csrf;
  if (!tokenFromForm || tokenFromForm !== req.session.csrfToken) {
    return res.status(403).render('error', {
      title: 'Fehler',
      message: 'Ungültige Anfrage (CSRF-Token fehlt oder abgelaufen). Bitte Seite neu laden und erneut versuchen.',
    });
  }
  next();
}

module.exports = { csrfToken, csrfProtect };
