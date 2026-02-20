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

## Monorepo Commands

Alle Komponenten installieren:

```bash
npm run install:all
```

Alle Komponenten bauen/checken:

```bash
npm run build
```

Nur eine Komponente bauen/checken:

```bash
npm run build:one -- web
npm run build:one -- service
npm run build:one -- sdk
npm run build:one -- core
```

Alle Komponenten updaten:

```bash
npm run update
```

Nur eine Komponente updaten:

```bash
npm run update:one -- web
npm run update:one -- service
npm run update:one -- sdk
npm run update:one -- core
```

## Hosting

- Service: `apps/assistant-service`
- Frontend: `apps/personal-luna`

Details: `DEPLOY-RUNBOOK-DE.md`

## Aufräumen nach Migration

Wenn dieses Monorepo deine aktive Arbeitsbasis ist, können alte lokale Duplikate gelöscht werden:

- alter Core-Ordner außerhalb Monorepo (du arbeitest dann nur noch in `packages/assistant-core`)
- alter Service-Ordner außerhalb Monorepo (du arbeitest dann nur noch in `apps/assistant-service`)
- alter Frontend-Ordner außerhalb Monorepo (du arbeitest dann nur noch in `apps/personal-luna`)

Wichtig: Nur löschen, wenn die Inhalte bereits ins Monorepo übernommen und auf Remote gesichert sind.
