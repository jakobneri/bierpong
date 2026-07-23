# Bierpong Tracker

Einfache Webapp, mit der beide Seiten einer Bierpong-Runde ihre Spiele
eintragen können. Accounts sind bewusst simpel gehalten (Username +
Passwort), Statistiken (Siege, Niederlagen, Winrate, Becher) werden
automatisch aus den bestätigten Spielen berechnet.

## Funktionsweise

- Jeder registriert sich mit Username + Passwort.
- **Live-Party** (`/party/new`) ist der einzige Weg, ein Spiel zu tracken:
  Alle Spieler sind gleichzeitig im selben Spiel dabei (1 gegen 1 oder 2
  gegen 2), joinen per Code/Link auf ihrem Handy und sehen das klassische
  Bierpong-Dreieck (4-3-2-1) beider Teams — die zwei Pyramiden zeigen sich
  spiegelbildlich zueinander, wie am echten Tisch.
  - Es gibt ein rundenbasiertes Wurfsystem: Nach 1 Wurf (1 gegen 1) bzw.
    2 Würfen (2 gegen 2) ist automatisch die andere Seite an der Reihe.
  - Man kann nur die Becher der **Gegenseite** antippen, nie die eigenen.
  - Ein "Daneben"-Knopf zählt einen Fehlwurf, ohne einen Becher zu treffen.
  - Änderungen sind per WebSocket (Socket.io) sofort bei allen sichtbar.
  - Ist ein Rack komplett leer, wird das Spiel automatisch beendet und
    direkt bestätigt in die Statistik übernommen — da alle live dabei
    waren, ist keine separate Bestätigung nötig.
- **Solo-Training** (`/solo`): Trackt die eigene Trefferquote in
  Pickup-Runden gegen unbekannte Gegner, ganz ohne deren Account. Man
  tippt den getroffenen Becher im selben Dreieck-Layout an (oder
  "Daneben"), und das Profil zeigt danach eine Heatmap, welche
  Becher-Positionen am häufigsten getroffen werden.
- Bestenliste (`/stats`) und persönliche Profile (`/stats/<username>`)
  zeigen automatisch berechnete Statistiken aus allen Live-Party-Spielen.
- **Admin-Dashboard** (`/admin`, nur für Admins sichtbar): Übersicht über
  Nutzer, Spiele und laufende Partys, plus Nutzerverwaltung (Admin-Rechte
  vergeben/entziehen, Accounts deaktivieren, Passwörter zurücksetzen). Der
  erste registrierte Account wird automatisch zum Admin — alternativ kann
  ein reiner Management-Account per `ADMIN_PASSWORD` in `.env` eingerichtet
  werden (siehe unten), der nicht selbst mitspielt.

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

### Optionaler Management-Account

Wer ausschließlich Nutzer verwalten will, ohne selbst als Spieler in
Statistik/Bestenliste aufzutauchen, kann in `.env` ein `ADMIN_PASSWORD`
setzen. Beim Start wird dann automatisch ein Account `admin` mit diesem
Passwort angelegt (bzw. bei Änderung synchronisiert). Dieser Account:

- kann sich nur im Admin-Dashboard bewegen (Nav zeigt nur "Admin"),
- kann keine Live-Party oder Solo-Training starten/beitreten,
- taucht nie in Bestenliste oder Spielerprofilen auf.

Der reguläre Weg (erster registrierter Account wird automatisch Admin)
funktioniert weiterhin, falls `ADMIN_PASSWORD` nicht gesetzt ist.

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
    matches.js          Spielverlauf (Spiele entstehen ausschließlich über Live-Party)
    stats.js            Bestenliste + Spielerprofile
    party.js             Live-Party erstellen/beitreten/starten
    solo.js              Solo-Trefferquote-Tracking
    admin.js             Admin-Übersicht + Nutzerverwaltung
views/                 EJS-Templates
public/                Statisches CSS/JS (inkl. Socket.io-Client-Logik)
```
