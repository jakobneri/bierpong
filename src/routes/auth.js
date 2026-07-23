const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { redirectIfAuthenticated } = require('../middleware/auth');
const { csrfProtect } = require('../middleware/csrf');

const router = express.Router();

const USERNAME_RE = /^[a-zA-Z0-9_]{3,20}$/;

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Zu viele Versuche. Bitte später erneut versuchen.',
});

const getUserByUsername = db.prepare('SELECT * FROM users WHERE username = ?');
const insertUser = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');

router.get('/register', redirectIfAuthenticated, (req, res) => {
  res.render('register', { title: 'Registrieren', error: null, form: {} });
});

router.post('/register', redirectIfAuthenticated, authLimiter, csrfProtect, async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';
  const passwordConfirm = req.body.passwordConfirm || '';

  const fail = (error) => res.status(400).render('register', { title: 'Registrieren', error });

  if (!USERNAME_RE.test(username)) {
    return fail('Benutzername muss 3-20 Zeichen lang sein (Buchstaben, Zahlen, Unterstrich).');
  }
  if (password.length < 6) {
    return fail('Passwort muss mindestens 6 Zeichen lang sein.');
  }
  if (password !== passwordConfirm) {
    return fail('Passwörter stimmen nicht überein.');
  }
  if (getUserByUsername.get(username)) {
    return fail('Benutzername ist bereits vergeben.');
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const info = insertUser.run(username, passwordHash);

  req.session.regenerate((err) => {
    if (err) return fail('Registrierung fehlgeschlagen, bitte erneut versuchen.');
    req.session.user = { id: info.lastInsertRowid, username };
    res.redirect('/dashboard');
  });
});

router.get('/login', redirectIfAuthenticated, (req, res) => {
  res.render('login', { title: 'Login', error: null });
});

router.post('/login', redirectIfAuthenticated, authLimiter, csrfProtect, async (req, res) => {
  const username = (req.body.username || '').trim();
  const password = req.body.password || '';

  const fail = () => res.status(401).render('login', {
    title: 'Login',
    error: 'Benutzername oder Passwort falsch.',
  });

  const user = getUserByUsername.get(username);
  if (!user) return fail();

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return fail();

  req.session.regenerate((err) => {
    if (err) return fail();
    req.session.user = { id: user.id, username: user.username };
    res.redirect('/dashboard');
  });
});

router.post('/logout', csrfProtect, (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
