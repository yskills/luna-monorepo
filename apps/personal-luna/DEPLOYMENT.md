# Personal Luna – Deploy (Frontend-only)

## Empfehlung (einfach + sauber getrennt)

- Frontend auf Vercel/Netlify/Render Static Site
- Backend als separater Assistant-Service (eigene URL)

## Warum getrennt?

- Dieses Repo hostet nur statische Vue-Dateien.
- Alle `/assistant/*` Endpunkte kommen aus deinem separaten Backend-Service.

## Schnellstart Frontend-Deploy

1. Repo auf GitHub pushen
2. Frontend deployen (z. B. Vercel/Netlify)
3. Build command: `npm run build`
4. Output directory: `dist`
5. ENV setzen:
  - `VITE_ASSISTANT_API_BASE_URL=https://<dein-assistant-service>/assistant`
  - optional `VITE_ASSISTANT_API_KEY=<key>`

## Backend/Trainer

- Backend-Deploy und LoRA-Hosting sind getrennt in deinem Service-Repo.
- Dieses Frontend kennt nur die API-URL und optional API-Key.

## Character-Definitionen

- Frontend Persona/Mapping: `src/config/lunaPreset.js`
- Backend Character/Prompt: im separaten Assistant-Service-Repo
