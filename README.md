# Luna Monorepo

## Was ist was?

- `apps/personal-luna` = Vue Frontend
- `packages/assistant-sdk` = Frontend API-Client (Verbindung zum Backend)
- `apps/assistant-service` = Node/Express Backend-Service
- `packages/assistant-core` = Assistant-Logik, die im Service läuft

Du hast es richtig verstanden: Frontend nutzt SDK → SDK spricht mit Backend-Service.

## Quickstart (lokal, 3 Schritte)

1) Dependencies installieren

```bash
npm install
npm run install:all
```

2) Service-Env anlegen (einmalig)

```bash
copy apps\assistant-service\.env.example apps\assistant-service\.env
```

3) Starten

- VS Code: `F5` → `Luna Full Stack (Monorepo F5)`
- oder Terminal: `npm run dev`

Danach:

- Frontend: `http://127.0.0.1:5173`
- Backend Health: `http://127.0.0.1:5050/health`

## Build / Update

- Alles bauen: `npm run build`
- Nur Frontend bauen: `npm run build:one -- web`
- Alles updaten: `npm run update`
- Nur Service updaten: `npm run update:one -- service`

## Für andere Projekte (einfach)

1) SDK installieren: `npm i @luna/assistant-sdk`
2) API-Base setzen: `VITE_ASSISTANT_API_BASE_URL=https://dein-service/assistant`
3) `createAssistantSdkClient({ baseUrl })` nutzen und `chat()/getMode()/setMode()` aufrufen

## Hosting

- Ja: Frontend und Backend getrennt hosten.
- Frontend kann z. B. auf GitHub Pages.
- Backend kann nicht auf GitHub Pages (Pages ist statisch), nutze z. B. Render/Railway/Fly.io/VPS.

Einfachster Start (empfohlen): `DEPLOY-QUICKSTART-DE.md`

## Häufige Fehler

- `Cannot GET /` auf Port 5050 ist normal, nutze `/health` oder `/assistant/...`
- `Failed to fetch` heißt meist: Service läuft nicht, falsche API-URL oder CORS-Thema
