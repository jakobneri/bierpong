const db = require('../db');

const getActiveFlagStmt = db.prepare('SELECT is_active, is_admin, is_management FROM users WHERE id = ?');

function attachUser(req, res, next) {
  res.locals.user = req.session.user || null;
  next();
}

function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect('/login');
  }

  // Re-check against the DB so a deactivated/demoted account loses access
  // immediately instead of only when the session cookie eventually expires.
  const row = getActiveFlagStmt.get(req.session.user.id);
  if (!row || !row.is_active) {
    return req.session.destroy(() => res.redirect('/login'));
  }
  req.session.user.isAdmin = !!row.is_admin;
  req.session.user.isManagement = !!row.is_management;
  res.locals.user = req.session.user;

  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !req.session.user.isAdmin) {
    return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
  }
  next();
}

function blockManagement(req, res, next) {
  if (req.session.user && req.session.user.isManagement) {
    return res.redirect('/admin');
  }
  next();
}

function redirectIfAuthenticated(req, res, next) {
  if (req.session.user) {
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { attachUser, requireAuth, requireAdmin, blockManagement, redirectIfAuthenticated };
