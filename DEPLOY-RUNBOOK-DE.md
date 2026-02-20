# Deploy Runbook (Monorepo)

Dieses Monorepo dient nur zur gemeinsamen Entwicklung. Deployment bleibt getrennt:

- Service deployen aus `apps/assistant-service`
- Frontend deployen aus `apps/personal-luna`

## 1) Backend-Service deployen

Arbeitsverzeichnis:

```bash
cd apps/assistant-service
```

Pflicht-Umgebungsvariablen (mindestens):

- `ASSISTANT_PORT` (z. B. `5050`)
- `ASSISTANT_API_KEY` (empfohlen für produktive Nutzung)
- `ASSISTANT_CORS_ORIGINS` (kommagetrennte Frontend-Domains)

Empfohlene zusätzliche Variablen:

- `ASSISTANT_LLM_ENABLED=true`
- `OLLAMA_BASE_URL` oder OpenAI-kompatible Endpoint-Variablen

Start-Command (Platform-unabhängig):

```bash
npm install
npm run start
```

Healthcheck:

```bash
GET /health
```

Assistant-Basis-URL für Frontend:

```text
https://<service-domain>/assistant
```

## 2) Frontend deployen

Arbeitsverzeichnis:

```bash
cd apps/personal-luna
```

Build-Variablen:

- `VITE_ASSISTANT_API_BASE_URL=https://<service-domain>/assistant`
- `VITE_ASSISTANT_API_KEY=<optional-wenn-service-key-aktiv>`

Build:

```bash
npm install
npm run build
```

Publish den erzeugten Inhalt aus:

```text
apps/personal-luna/dist
```

## 3) Smoke-Test nach Deploy

1. Frontend laden
2. Mode abrufen (`GET /assistant/mode` indirekt über UI)
3. Chat senden (`POST /assistant/chat`)
4. Optional Preset anwenden (`POST /assistant/luna/presets/apply`)

## 4) Betriebsregeln

- Frontend und Service unabhängig versionieren/deployen
- CORS immer auf echte Frontend-Domains einschränken
- API-Key im Frontend nur nutzen, wenn bewusst so vorgesehen
- Secret-Werte niemals committen (`.env` bleibt lokal)
