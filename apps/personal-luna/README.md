# Personal Luna (Vue)

Mobile-first Personal Assistant App auf Vue 3 + Vite.

## Features

- Full Assistant View (Sidebar + Chat)
- Chat-only View (fokussiert)
- API-Anbindung an dein bestehendes Assistant Backend
- Charakter-/Mode-Preset in zentraler Config
- Responsiv für Handy und Laptop

## Setup

Am besten über das Monorepo starten (siehe `README.md` im Root): `npm run dev` startet Service und App.
Die App spricht same-origin mit `/assistant` und `/auth` (lokal über den Vite-Proxy auf Port 5050).

## Login

Ohne Login lädt nur die Login-Seite. Das Passwort wird im Service gesetzt (`npm run set-password`),
die App bekommt danach ein HttpOnly-Session-Cookie. Es gibt keine API-Keys im Frontend.

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
