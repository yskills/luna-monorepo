# Personal Luna (Vue)

Mobile-first Personal Assistant App auf Vue 3 + Vite.

## Features

- Full Assistant View (Sidebar + Chat)
- Chat-only View (fokussiert)
- API-Anbindung an dein bestehendes Assistant Backend
- Charakter-/Mode-Preset in zentraler Config
- Responsiv für Handy und Laptop

## Setup

```bash
npm install
cp .env.example .env
npm run dev
```

## F5 (empfohlen)

- Öffne dieses Repo (`personal-luna`) in VS Code.
- Drücke `F5` und wähle `Luna Full Stack (F5)`.
- Das startet automatisch:
	- `luna-assistant-service` (Port 5050)
	- `personal-luna` Frontend (Port 5173)
	- Browser-Debug-Session
- Beim Stoppen werden die Dev-Ports automatisch beendet.

## Architektur (Frontend-only)

- Dieses Repo enthält nur die Vue-App.
- Das Backend läuft als separater Service (deployte URL).
- Die App spricht ausschließlich über `VITE_ASSISTANT_API_BASE_URL` mit der API.

## Zielarchitektur (3 Repos)

- `Aissistant` → Core-Library (`@luna/assistant-core`), Routen/LLM/Memory.
- `luna-assistant-service` → deploybare API, nutzt die Core-Library serverseitig.
- `personal-luna` → produktive Vue-UI, nutzt nur API/SDK.

## Reuse & Hosting (State of the Art)

- Frontend und Backend getrennt deployen.
- Backend als eigenständigen Service hosten und in der App nur die API-URL konfigurieren.
- Optional API-Key über `VITE_ASSISTANT_API_KEY` senden.

## API Verbindung

Setze in `.env`:

```env
VITE_ASSISTANT_API_BASE_URL=https://your-assistant-service.example.com/assistant
VITE_ASSISTANT_API_KEY=
```

Erwartete Endpoints:

- `POST /chat`
- `GET/POST /mode`
- `POST /luna/presets/apply`
- `GET /voice/settings`

## Preset-Konfiguration

Die persönliche Luna-Config liegt in:

- `src/config/lunaPreset.js`

Dort stellst du ein:

- `characterId`
- Start-Mode (`normal`/`uncensored`)
- Preset-Mapping pro Mode
- Avatar/Voice-Preset

## Wo definierst du den Character?

- Frontend-Preset (Name, Style, Avatar, Mode-Mapping): `src/config/lunaPreset.js`
- Backend-Character-Definition (Systemprompt, Tones, Profile): `../assistant-service/config/assistant-mode-config.local.json`

## Nutzung auf jedem Device

- App lokal/hosted öffnen (Laptop/Handy).
- Beide Geräte nutzen dieselbe Backend-Service-URL aus `VITE_ASSISTANT_API_BASE_URL`.

## Echtes Deploy

- Siehe: `DEPLOYMENT.md`
- Dieses Repo deployt nur die Web-App.
- Backend/Trainer separat hosten.
