# Deploy Quickstart (kostenlos & einfach)

Empfehlung für den schnellsten Start:

- **Backend:** Render Web Service (Free)
- **Frontend:** Render Static Site (Free)

Warum: ein Anbieter, ein Dashboard, kein Extra-Setup zwischen Diensten.

## 1) Repo pushen

Monorepo nach GitHub pushen (main branch).

## 2) Backend deployen (Render)

In Render:

1. **New +** → **Web Service**
2. GitHub Repo verbinden: `luna-monorepo`
3. Einstellungen:
   - **Root Directory:** `apps/assistant-service`
   - **Build Command:** `npm install`
   - **Start Command:** `npm run start`
4. Environment Variables setzen:
   - `HOST=0.0.0.0`
   - `PORT=10000` (oder Render Default-Port via `PORT`)
   - `ASSISTANT_CORS_ORIGINS=https://<deine-frontend-domain>`
   - `ASSISTANT_API_KEY=<optional-aber-empfohlen>`
   - alle LLM/Model Variablen, die du brauchst
5. Deploy starten und URL notieren:
   - Beispiel: `https://luna-service.onrender.com`

Healthcheck:

- `https://<service-domain>/health`

## 3) Frontend deployen (Render)

In Render:

1. **New +** → **Static Site**
2. GitHub Repo verbinden: `luna-monorepo`
3. Einstellungen:
   - **Root Directory:** `apps/personal-luna`
   - **Build Command:** `npm install && npm run build`
   - **Publish Directory:** `dist`
4. Environment Variables:
   - `VITE_ASSISTANT_API_BASE_URL=https://<service-domain>/assistant`
   - `VITE_ASSISTANT_API_KEY=<optional-wenn-backend-key-an>`
5. Deploy starten

## 4) Test

1. Frontend öffnen
2. Chat senden
3. Wenn Fehler: zuerst Backend `/health` prüfen

## Wichtige Hinweise

- `Cannot GET /` auf Backend-Root ist normal.
- Nutze `/health` oder `/assistant/...`.
- Render Free kann schlafen (Cold Start von einigen Sekunden).

## Alternative

- Frontend auf Cloudflare Pages (Free)
- Backend auf Render (Free)

Das ist oft schneller beim Frontend, aber etwas mehr Setup als "alles auf Render".
