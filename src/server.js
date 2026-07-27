require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const session = require('express-session');
const { Server: SocketIOServer } = require('socket.io');
const helmet = require('helmet');
const crypto = require('crypto');

const db = require('./db');
const SqliteSessionStore = require('./sessionStore');
const { attachUser, requireAuth } = require('./middleware/auth');
const { csrfToken } = require('./middleware/csrf');

const authRoutes = require('./routes/auth');
const matchRoutes = require('./routes/matches');
const statsRoutes = require('./routes/stats');
const adminRoutes = require('./routes/admin');
const createPartyRouter = require('./routes/party');
const soloRoutes = require('./routes/solo');
const legalRoutes = require('./routes/legal');
const { router: accountRoutes, avatarsDir } = require('./routes/account');
const initSocket = require('./socket');

const app = express();
const httpServer = http.createServer(app);
const io = new SocketIOServer(httpServer);
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
      // Only the reverse proxy should decide http->https upgrades; forcing it
      // here breaks direct http access (e.g. before a TLS proxy is set up).
      upgradeInsecureRequests: null,
    },
  },
}));

app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/avatars', express.static(avatarsDir, { maxAge: '30d' }));

const sessionMiddleware = session({
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
});

app.use(sessionMiddleware);
// Share the same session middleware with Socket.io so live-party sockets
// know which logged-in user is behind each connection.
io.engine.use(sessionMiddleware);

app.use(attachUser);
app.use(csrfToken);

// Cache-busting query string for static assets (CSS/JS), derived from
// process start time. CDNs in front of the app (e.g. Cloudflare) cache
// static files at the edge by file extension regardless of origin
// headers, so a plain redeploy can leave visitors on stale JS/CSS until
// this changes the URL and forces a fresh fetch.
const assetVersion = Date.now().toString(36);
app.use((req, res, next) => {
  res.locals.assetVersion = assetVersion;
  next();
});

app.use(authRoutes);
app.use(matchRoutes);
app.use(statsRoutes);
app.use(soloRoutes);
app.use(accountRoutes);
app.use('/admin', adminRoutes);
app.use(createPartyRouter(io));
app.use(legalRoutes);

initSocket(io);

const dashboardStatsStmt = db.prepare(`
  SELECT
    COUNT(*) AS games,
    SUM(CASE WHEN mp.team = m.winner THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN mp.team = m.winner THEN 0 ELSE 1 END) AS losses
  FROM match_players mp
  JOIN matches m ON m.id = mp.match_id AND m.status = 'confirmed'
  WHERE mp.user_id = ?
`);

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  res.redirect(req.session.user.isManagement ? '/admin' : '/dashboard');
});

app.get('/dashboard', requireAuth, (req, res) => {
  if (req.session.user.isManagement) return res.redirect('/admin');

  const raw = dashboardStatsStmt.get(req.session.user.id);
  const stats = {
    games: raw.games || 0,
    wins: raw.wins || 0,
    losses: raw.losses || 0,
    winRate: raw.games ? (raw.wins / raw.games) * 100 : 0,
  };

  res.render('dashboard', { title: 'Dashboard', stats });
});

app.use((req, res) => {
  res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).render('error', { title: 'Fehler', message: 'Etwas ist schiefgelaufen. Bitte später erneut versuchen.' });
});

httpServer.listen(port, () => {
  console.log(`Bierpong Tracker läuft auf Port ${port}`);
});
