# Luna deployen (eigener Server, kostenlos möglich)

Ziel: ein kleiner Linux-Server (z. B. Oracle Cloud Always Free, 2 ARM-Kerne / 12 GB RAM,
oder Hetzner CAX11 für ca. 4 €/Monat). Darauf laufen drei Container:

- `luna` – Service + Web-App (Port nur intern)
- `ollama` – lokales Modell (kein Port nach außen)
- `caddy` – HTTPS mit automatischem Let's-Encrypt-Zertifikat

## 1) Domain

Kostenlos: Subdomain bei [DuckDNS](https://www.duckdns.org) anlegen und auf die Server-IP zeigen lassen,
z. B. `meine-luna.duckdns.org`. In der Server-Firewall Ports 80 und 443 öffnen.

## 2) Server vorbereiten

```bash
# Docker installieren (Ubuntu)
curl -fsSL https://get.docker.com | sh
git clone https://github.com/yskills/luna-monorepo.git
cd luna-monorepo
cp deploy/.env.example deploy/.env
```

`deploy/.env` ist git-ignored. `LUNA_DOMAIN` eintragen.

## 3) Admin-Passwort

```bash
docker compose build
docker compose run --rm luna node scripts/set-password.mjs --print
```

Die zwei ausgegebenen Zeilen (`LUNA_ADMIN_PASSWORD_HASH=…`, `LUNA_SESSION_SECRET=…`) in `deploy/.env` eintragen.
Es wird nur der Hash gespeichert, nie das Passwort.

## 4) Starten

```bash
docker compose --profile https up -d
docker compose exec ollama ollama pull qwen3:4b   # Modell aus deploy/.env (LLM_MODEL)
```

Danach `https://<deine-domain>` öffnen und einloggen. Status nach Login: `https://<deine-domain>/backend`.

## 5) Outlook verbinden (optional, nur lesen)

Luna liest ungelesene Mails und die heutigen Termine. Sie kann nichts senden oder löschen (Rechte: `Mail.Read`, `Calendars.Read`).

1. https://entra.microsoft.com öffnen, mit deinem Microsoft-Konto anmelden.
2. **App registrations → New registration**
   - Name: `Luna`
   - Supported account types: **Personal Microsoft accounts only**
   - Redirect URI: Plattform **Web**, `https://<deine-domain>/api/connectors/outlook/callback`
3. Auf der Übersicht die **Application (client) ID** kopieren.
4. **Certificates & secrets → New client secret** (24 Monate), den **Value** sofort kopieren.
5. In `deploy/.env` auf dem Server eintragen (nie committen, nie in einen Chat posten):
   ```
   OUTLOOK_CLIENT_ID=<client id>
   OUTLOOK_CLIENT_SECRET=<secret value>
   OUTLOOK_REDIRECT_URI=https://<deine-domain>/api/connectors/outlook/callback
   LUNA_TOKEN_KEY=<Ausgabe von: openssl rand -base64 48>
   ```
6. `docker compose up -d luna`, dann im Cockpit unter „Verbindungen“ auf **Verbinden** tippen.

Die Microsoft-Tokens liegen verschlüsselt (AES-256-GCM, Schlüssel `LUNA_TOKEN_KEY`) in der SQLite-Datei. Ohne `LUNA_TOKEN_KEY` wird der Schlüssel aus dem Session-Secret abgeleitet; ändert sich das, musst du Outlook neu verbinden. Das Client-Secret läuft nach 24 Monaten ab: dann Schritt 4 und 5 wiederholen.

## Passwort ändern / alle Geräte abmelden

Schritt 3 wiederholen, Werte ersetzen, dann `docker compose up -d luna`.
Ein neues Passwort oder Session-Secret macht alle bestehenden Logins ungültig.

## Backup

Alle Daten liegen im Volume `luna-data` (SQLite).

```bash
docker run --rm -v luna-monorepo_luna-data:/data -v "$PWD":/backup busybox tar czf /backup/luna-data.tgz -C /data .
```
