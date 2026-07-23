# Bierpong Tracker

Einfache Webapp, mit der beide Seiten einer Bierpong-Runde ihre Spiele
eintragen können. Accounts sind bewusst simpel gehalten (Username +
Passwort), Statistiken (Siege, Niederlagen, Winrate, Becher) werden
automatisch aus den bestätigten Spielen berechnet.

## Funktionsweise

- Jeder registriert sich mit Username + Passwort.
- Ein Spieler trägt ein Spiel ein (1 gegen 1 oder 2 gegen 2), inkl. Ergebnis.
- Das Spiel ist erst **"pending"** — mindestens ein Spieler der Gegenseite
  muss es unter "Ausstehend" bestätigen, damit es in die Statistik einfließt.
  So kann niemand alleine sich selbst Siege gutschreiben.
- Die Gegenseite kann das Spiel stattdessen auch ablehnen (z. B. bei
  Falscheingabe).
- Bestenliste (`/stats`) und persönliche Profile (`/stats/<username>`)
  zeigen automatisch berechnete Statistiken aus allen bestätigten Spielen.
- **Live-Party** (`/party/new`): Alle Spieler sind gleichzeitig im selben
  Spiel dabei (1 gegen 1 oder 2 gegen 2), joinen per Code/Link auf ihrem
  Handy und sehen das klassische Bierpong-Dreieck (4-3-2-1) beider Teams.
  Ein Treffer wird angetippt und ist per WebSocket (Socket.io) sofort bei
  allen sichtbar. Ist ein Rack komplett leer, wird das Spiel automatisch
  beendet und direkt bestätigt in die Statistik übernommen — da alle
  Beteiligten live dabei waren, ist keine separate Bestätigung nötig.
- **Solo-Training** (`/solo`): Trackt die eigene Trefferquote in
  Pickup-Runden gegen unbekannte Gegner, ganz ohne deren Account — einfach
  Treffer/Fehlwurf antippen und die Sitzung speichern.
- **Admin-Dashboard** (`/admin`, nur für Admins sichtbar): Übersicht über
  Nutzer, Spiele und laufende Partys, plus Nutzerverwaltung (Admin-Rechte
  vergeben/entziehen, Accounts deaktivieren, Passwörter zurücksetzen). Der
  erste registrierte Account wird automatisch zum Admin.

## Tech-Stack

- Node.js + Express, serverseitig gerenderte Views (EJS) — keine
  Build-Pipeline nötig.
- SQLite (better-sqlite3) als einzige Datenbank, eine Datei auf Disk.
- Sessions liegen ebenfalls in SQLite (eigener, minimaler Store), Login
  übersteht also Neustarts.
- Socket.io für Live-Party-Updates, authentifiziert über dieselbe
  Session wie die restliche App.
- Passwörter werden mit bcrypt gehasht.
- CSRF-Schutz auf allen Formularen, Rate-Limiting auf Login/Registrierung,
  Security-Header via Helmet.
- Mobile-first: Hamburger-Navigation, große Touch-Targets, responsive
  Tabellen — konzipiert für die Nutzung während des Spiels auf dem Handy.

## Lokale Entwicklung

```bash
npm install
cp .env.example .env
# SESSION_SECRET in .env eintragen (siehe Kommentar in der Datei)
npm run dev
```

Die App läuft dann auf http://localhost:3000.

## Deployment auf einem Server (Docker)

Vorausgesetzt: Ein Server (z. B. kleiner VPS) mit Docker + Docker Compose.

```bash
git clone <repo-url>
cd bierpong
export SESSION_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
docker compose up -d --build
```

Die App läuft danach auf Port 3000 des Servers, die SQLite-Datenbank liegt
persistent im Docker-Volume `bierpong-data`.

### Öffentlich erreichbar machen (HTTPS)

Die App selbst spricht nur HTTP. Für öffentliches Hosting empfiehlt sich
ein Reverse Proxy mit automatischem TLS-Zertifikat davor, z. B.
[Caddy](https://caddyserver.com/) oder nginx + certbot:

```
# Caddyfile Beispiel
bierpong.deine-domain.de {
    reverse_proxy localhost:3000
}
```

Caddy holt sich automatisch ein Let's-Encrypt-Zertifikat. Wichtig: In
`.env` bzw. den Docker-Compose-Umgebungsvariablen `NODE_ENV=production`
setzen, damit Cookies als `secure` markiert werden (nur über HTTPS
übertragen).

### Backups

Die komplette App-Daten liegen in einer einzigen SQLite-Datei im Volume
`bierpong-data` (Pfad im Container: `/data/bierpong.db`). Für ein Backup
reicht es, diese Datei regelmäßig zu kopieren, z. B.:

```bash
docker compose exec bierpong sh -c "sqlite3 /data/bierpong.db '.backup /data/backup.db'"
docker cp $(docker compose ps -q bierpong):/data/backup.db ./backup-$(date +%F).db
```

## Projektstruktur

```
src/
  server.js          Express-App, Middleware-Wiring, Socket.io-Setup
  db/index.js         SQLite-Verbindung + Schema + Migrationen
  sessionStore.js      Eigener SQLite-Session-Store
  socket.js            Live-Party Echtzeit-Logik (Becher-Taps, Spielende)
  partyState.js         Geteilte Party-Helper (HTTP-Routen + Sockets)
  middleware/          Auth-, Admin- und CSRF-Middleware
  routes/
    auth.js            Register/Login/Logout
    matches.js          Spiele manuell anlegen, bestätigen, ablehnen, Verlauf
    stats.js            Bestenliste + Spielerprofile
    party.js             Live-Party erstellen/beitreten/starten
    solo.js              Solo-Trefferquote-Tracking
    admin.js             Admin-Übersicht + Nutzerverwaltung
views/                 EJS-Templates
public/                Statisches CSS/JS (inkl. Socket.io-Client-Logik)
```
