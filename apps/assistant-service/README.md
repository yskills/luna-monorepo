# Luna Assistant Service

Gehosteter Backend-Service für Luna-Frontends.

## Start

1. `.env.example` nach `.env` kopieren
2. Config-Datei bereitstellen: `config/assistant-mode-config.local.json`
3. Optional Preset-Mapping kopieren:

```bash
cp config/luna-presets.example.json config/luna-presets.local.json
```

4. Starten:

```bash
npm install
npm run dev
```

Health:

```bash
curl http://127.0.0.1:5050/health
```

## Login

Pflicht. `npm run set-password` setzt das Admin-Passwort (nur der Hash landet in `.env`).
Endpoints: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`. Alles unter `/assistant` und `/backend` braucht Login.
Für Server-zu-Server-Jobs gibt es optional `ASSISTANT_API_KEY` (Bearer), nie im Frontend verwenden.

## Sprache umschalten

Die Reply-Sprache kann zur Laufzeit über das Settings-Endpoint umgeschaltet werden.

```bash
curl -X POST http://127.0.0.1:5050/assistant/settings \
	-H "Authorization: Bearer $ASSISTANT_API_KEY" \
	-H "Content-Type: application/json" \
	-d '{"characterId":"luna","language":"en"}'
```

`language` akzeptiert ISO-ähnliche Codes wie `en`, `de`, `en-us`, `pt-br`.

## Sicherheit

Siehe `SECURITY-DE.md` im Repo-Root.
