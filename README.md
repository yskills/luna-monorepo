# Luna Monorepo

Private Luna-App: nur du kommst rein (Admin-Passwort), alles läuft auf deinem eigenen Server.

## Was ist was?

- `apps/personal-luna` = Vue PWA (Frontend)
- `packages/assistant-sdk` = API-Client fürs Frontend
- `apps/assistant-service` = Node/Express-Service: Login, API, liefert die Web-App aus
- `packages/assistant-core` = Assistant-Logik (LLM, Memory, Modes)

Frontend und API laufen auf **derselben Domain**. Der Login ist ein HttpOnly-Session-Cookie,
im Frontend gibt es keine Keys.

## Quickstart (lokal)

1) Dependencies installieren

```bash
npm install
npm run install:all
```

2) Admin-Passwort setzen (einmalig). Fragt verdeckt ab und schreibt nur den Hash in
`apps/assistant-service/.env` (git-ignored, wird nie gepusht):

```bash
cd apps/assistant-service
npm run set-password
```

3) Starten

- VS Code: `F5` → `Luna Full Stack (Monorepo F5)`
- oder Terminal: `npm run dev`

Danach `http://127.0.0.1:5173` öffnen und mit dem Passwort einloggen.
Lokal ohne HTTPS in `apps/assistant-service/.env` `LUNA_COOKIE_SECURE=false` lassen (Standard außerhalb von Produktion).

## Build / Update

- Alles bauen: `npm run build`
- Nur Frontend bauen: `npm run build:one -- web`
- Alles updaten: `npm run update`

## Hosting

Ein Server, ein Container-Stack, HTTPS automatisch: siehe `DEPLOY-DE.md`.
Sicherheitsmodell und Regeln: siehe `SECURITY-DE.md`.

## Häufige Fehler

- `401 Login required` → nicht eingeloggt oder Session abgelaufen
- `403 Origin not allowed` → Frontend und API laufen nicht auf derselben Domain
- Service startet nicht mit `No admin password configured` → `npm run set-password` ausführen
