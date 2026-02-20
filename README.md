# Luna Monorepo

Zentrale Verwaltung für 3 deploybare Bausteine:

- `packages/assistant-core` → Core-Library (`@luna/assistant-core`)
- `apps/assistant-service` → gehostete API (`@luna/assistant-service`)
- `packages/assistant-sdk` → Frontend-Schnittstelle (`@luna/assistant-sdk`)
- `apps/personal-luna` → Vue/PWA Frontend (`personal-luna`)

## Ziel

Management in einem Monorepo, Deployment weiterhin getrennt:

- Backend-Service separat hosten
- Frontend separat hosten

## Lokale Nutzung

```bash
npm install
npm run dev:service
npm run dev:web
```

oder in `apps/personal-luna` direkt `F5` mit `Luna Full Stack (F5)`.

## Hosting

- Service: `apps/assistant-service`
- Frontend: `apps/personal-luna`

Details: `DEPLOY-RUNBOOK-DE.md`
