---
name: verify
description: Run the same checks as Luna's CI locally before pushing - core and service tests, web build, frontend secret check, dependency audit. Use before every push or PR update.
---

# Verify before pushing

Run these from the repo root. They mirror `.github/workflows/ci.yml`; if CI changes, update this.

```
(cd packages/assistant-core && npm ci && npm test)
(cd apps/assistant-service && npm ci && npm test)
(cd apps/personal-luna && npm ci && npm run build)
! grep -rE "VITE_[A-Z_]*(KEY|SECRET|TOKEN|PASSWORD)" apps/personal-luna/src apps/personal-luna/.env.example
for d in packages/assistant-core apps/assistant-service apps/personal-luna; do (cd $d && npm audit --omit=dev --audit-level=high); done
```

Then re-read your own diff (`git diff origin/main...`) as a reviewer would:

- Any secret, token, password, personal data or real email in code, tests, fixtures or screenshots?
- Any new route without the auth middleware, any write route without the CSRF guard?
- Any string from outside (web, mail, social, user input) reaching SQL, a shell, a file path,
  `innerHTML`/`v-html`, or the model's system prompt?
- Any inline script, third-party origin, or remote font that the CSP would block?
- Tests for the new behavior, and did they fail before the change?

Push only when everything above is clean. CI also runs a Docker build and gitleaks, which you
can't always reproduce locally; watch them after pushing.
