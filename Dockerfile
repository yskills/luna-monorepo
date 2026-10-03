# syntax=docker/dockerfile:1

# ---- Web-App (Vue PWA) bauen ----
FROM node:22-bookworm-slim AS web
WORKDIR /repo
COPY packages/assistant-sdk packages/assistant-sdk
COPY apps/personal-luna/package.json apps/personal-luna/package-lock.json apps/personal-luna/
RUN cd apps/personal-luna && npm ci
COPY apps/personal-luna apps/personal-luna
RUN cd apps/personal-luna && npm run build

# ---- Service-Abhängigkeiten (nur Produktion) ----
FROM node:22-bookworm-slim AS deps
WORKDIR /repo
COPY packages/assistant-core packages/assistant-core
COPY apps/assistant-service/package.json apps/assistant-service/package-lock.json apps/assistant-service/
RUN cd apps/assistant-service && npm ci --omit=dev

# ---- Laufzeit ----
FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=5050 \
    LUNA_WEB_DIST=/repo/apps/personal-luna/dist \
    ASSISTANT_MEMORY_FILE=/data/assistant-memory.sqlite
WORKDIR /repo
COPY --from=deps /repo /repo
COPY apps/assistant-service apps/assistant-service
COPY --from=web /repo/apps/personal-luna/dist apps/personal-luna/dist
# Root-Dateisystem läuft read-only: alles Beschreibbare (Memory, Reports, Training) liegt in /data.
RUN rm -f apps/assistant-service/.env \
 && mkdir -p /data/reports \
 && ln -s /data apps/assistant-service/data \
 && ln -s /data/reports apps/assistant-service/reports \
 && chown -R node:node /data
USER node
WORKDIR /repo/apps/assistant-service
EXPOSE 5050
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:5050/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--preserve-symlinks", "--preserve-symlinks-main", "src/server.mjs"]
