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

## Frontend-Anbindung

Im Vue-Frontend:

```env
VITE_ASSISTANT_API_BASE_URL=http://127.0.0.1:5050/assistant
VITE_ASSISTANT_API_KEY=
```

## Sicherheit

- `ASSISTANT_API_KEY` setzen, damit `/assistant/*` geschützt ist.
- `ASSISTANT_CORS_ORIGINS` auf erlaubte Frontend-Domains begrenzen.
