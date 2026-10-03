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

## Passwort ändern / alle Geräte abmelden

Schritt 3 wiederholen, Werte ersetzen, dann `docker compose up -d luna`.
Ein neues Passwort oder Session-Secret macht alle bestehenden Logins ungültig.

## Backup

Alle Daten liegen im Volume `luna-data` (SQLite).

```bash
docker run --rm -v luna-monorepo_luna-data:/data -v "$PWD":/backup busybox tar czf /backup/luna-data.tgz -C /data .
```
