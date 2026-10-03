# Sicherheit

## Login

- Ein Admin-Passwort, gespeichert nur als **scrypt-Hash** (N=2^17, r=8, p=1) in einer git-ignored `.env`.
  `npm run set-password` erzeugt Hash + Session-Secret, das Passwort selbst wird nirgends gespeichert.
- Fail-closed: ohne Passwort startet der Service nicht. `LUNA_AUTH_DISABLED=true` ist nur lokal erlaubt und in Produktion blockiert.
- Session: signiertes HttpOnly-Cookie (`__Host-` Prefix, `Secure`, `SameSite=Strict`), standardmäßig 30 Tage.
  Der Signaturschlüssel hängt am Passwort-Hash: Passwortwechsel meldet alle Geräte ab.
- Brute-Force-Schutz: 5 Fehlversuche pro IP und 20 insgesamt pro 15 Minuten, danach Sperre.
  Die echte IP kommt nur über `TRUST_PROXY` (sonst lassen sich IPs per `X-Forwarded-For` fälschen).

## Web

- Frontend und API auf derselben Domain, kein CORS.
- CSRF: `SameSite=Strict` + Prüfung von `Origin`/`Sec-Fetch-Site` + nur JSON bei schreibenden Requests.
- Security-Header über helmet: strikte CSP (keine Inline-Skripte, keine fremden Quellen), HSTS, `frame-ancestors 'none'`, nosniff.
- Keine Secrets im Frontend: alles mit `VITE_` landet öffentlich im Bundle. CI bricht ab, wenn jemand `VITE_*KEY/SECRET/TOKEN/PASSWORD` einführt.
- Status-Seite rendert nur mit `textContent` (kein `innerHTML`), Fehlerantworten ohne Stacktraces.

## Injection

- SQL: nur Prepared Statements (better-sqlite3).
- Shell: Trainings-Kommandos sind standardmäßig aus (`ASSISTANT_TRAINING_API_ENABLED=false`).
  Wenn an, werden alle Argumente gegen eine Whitelist geprüft (unter Windows läuft `npm` über eine Shell).
- Pfade: Adapter-Namen können das Adapter-Verzeichnis nicht verlassen.
- **Prompt Injection**: Web-Suchergebnisse sind fremder Text. Sie gehen nie als System-Nachricht ans Modell,
  sondern als markierte Daten (`<untrusted_web_results>`), und das System-Prompt verbietet, Anweisungen darin zu befolgen.
  Grundregel für alle künftigen Tools (Mail, Posten, Zahlungen): Luna darf nur **Entwürfe** erzeugen,
  ausgeführt wird erst nach deiner Bestätigung in der Freigabe-Liste. Der Secret-Mode bekommt keine Tools.

## Betrieb

- Container läuft als Nicht-Root, read-only Dateisystem, keine Linux-Capabilities, `no-new-privileges`.
- Ollama hat keinen Port nach außen; Luna-Port ist nur an `127.0.0.1` gebunden, nach außen nur Caddy (HTTPS).
- CI: Tests, Abhängigkeits-Audit (high+), Docker-Build und gitleaks-Secret-Scan bei jedem Push.
