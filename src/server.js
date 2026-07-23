require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const crypto = require('crypto');

const db = require('./db');
const SqliteSessionStore = require('./sessionStore');
const { attachUser, requireAuth } = require('./middleware/auth');
const { csrfToken } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const matchRoutes = require('./routes/matches');
const statsRoutes = require('./routes/stats');

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
const port = process.env.PORT || 3000;

let sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret) {
  if (isProduction) {
    console.error('FATAL: SESSION_SECRET must be set in production. See .env.example.');
    process.exit(1);
  }
  sessionSecret = crypto.randomBytes(32).toString('hex');
  console.warn('WARNING: No SESSION_SECRET set, using a random one-off secret (sessions will not survive restarts).');
}

app.set('trust proxy', 1);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", 'data:'],
    },
  },
}));

app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use(session({
  store: new SqliteSessionStore(),
  secret: sessionSecret,
  name: 'bierpong.sid',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  },
}));

app.use(attachUser);
app.use(csrfToken);

app.use(authRoutes);
app.use(matchRoutes);
app.use(statsRoutes);

const dashboardStatsStmt = db.prepare(`
  SELECT
    COUNT(*) AS games,
    SUM(CASE WHEN mp.team = m.winner THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN mp.team = m.winner THEN 0 ELSE 1 END) AS losses
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id AND m.status = 'confirmed'
  WHERE mp.user_id = ?
`);

const pendingCountStmt = db.prepare(`
  SELECT m.id, m.created_by,
    (SELECT team FROM match_players WHERE match_id = m.id AND user_id = m.created_by) AS creator_team,
    mp.team AS my_team
  FROM matches m
  JOIN match_players mp ON mp.match_id = m.id
  WHERE mp.user_id = ? AND m.status = 'pending'
`);

app.get('/', (req, res) => {
  res.redirect(req.session.user ? '/dashboard' : '/login');
});

app.get('/dashboard', requireAuth, (req, res) => {
  const raw = dashboardStatsStmt.get(req.session.user.id);
  const stats = {
    games: raw.games || 0,
    wins: raw.wins || 0,
    losses: raw.losses || 0,
    winRate: raw.games ? (raw.wins / raw.games) * 100 : 0,
  };
  const pendingCount = pendingCountStmt.all(req.session.user.id)
    .filter((r) => r.my_team !== r.creator_team).length;

  res.render('dashboard', { title: 'Dashboard', stats, pendingCount });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Fehler', message: 'Etwas ist schiefgelaufen. Bitte später erneut versuchen.' });
});

app.listen(port, () => {
  console.log(`Bierpong Tracker läuft auf Port ${port}`);
});
