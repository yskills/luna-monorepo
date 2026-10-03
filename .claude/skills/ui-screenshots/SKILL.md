---
name: ui-screenshots
description: Run Luna locally and take phone and desktop screenshots of its pages (or of a reference website) with headless Chromium. Use to check UI changes and to produce the screenshots every UI pull request needs.
---

# UI screenshots

## 1. Build and start Luna

```
(cd packages/assistant-core && npm ci)
(cd apps/assistant-service && npm ci)
(cd apps/personal-luna && npm ci && npm run build)
```

Start the service with a throwaway password (local only, never a real one, never committed).
It serves the built app on http://127.0.0.1:5050. Ollama is not needed for screenshots.

```
cd apps/assistant-service
LUNA_SHOT_PASSWORD=$(openssl rand -hex 12)
LUNA_ADMIN_PASSWORD=$LUNA_SHOT_PASSWORD LUNA_COOKIE_SECURE=false \
  node --preserve-symlinks --preserve-symlinks-main src/server.mjs &
```

Run it in the background, and keep `LUNA_SHOT_PASSWORD` exported for the next step. After
changing frontend code, rebuild the web app; the service picks up the new `dist/`.

## 2. Shoot

```
LUNA_SHOT_PASSWORD=... node .claude/scripts/shoot.mjs --out .shots / /lists /money /luna
```

- Pages: `/` cockpit, `/luna` full assistant, `/chat`, `/lists`, `/money`, `/login`.
- Each page is saved as `<page>-phone.png` (390x844 @2x) and `<page>-desktop.png` (1440x900).
- `--full` captures the whole scrolling page; `--only phone` skips desktop.
- Console errors are printed; a 401 from `/auth/me` before login is expected, anything else is a
  bug to look at.
- `.shots/` is git-ignored. Screenshots go to the PR and the thread, not into the repo.

Open the PNGs and look at them before anyone else does. Fill pages with realistic data when the
change is about how data looks; an empty dashboard hides most problems.
