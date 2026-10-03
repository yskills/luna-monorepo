import crypto from 'node:crypto'
import path from 'node:path'
import { existsSync } from 'node:fs'
import express from 'express'
import helmet from 'helmet'
import { createAuth, csrfGuard, resolveAuthConfig } from './security/auth.mjs'
import { renderStatusPage } from './statusPage.mjs'
import { openCockpitDb } from './cockpit/db.mjs'
import { createCockpitStore } from './cockpit/store.mjs'
import { createBriefingService } from './cockpit/briefing.mjs'
import { createCockpitRouter } from './cockpit/routes.mjs'
import { createSecretBox, createSecretStore } from './connectors/secretBox.mjs'
import { createOutlookConnector } from './connectors/outlook.mjs'
import { createTikTokConnector } from './connectors/tiktok.mjs'
import { createConnectorRouter, createOAuthCallbackRouter } from './connectors/routes.mjs'

const resolveRuntimePath = (targetPath) => {
  const normalized = String(targetPath || '').trim()
  if (!normalized) return ''
  return path.isAbsolute(normalized) ? normalized : path.resolve(process.cwd(), normalized)
}

function parseTrustProxy(value) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === 'false' || raw === '0') return false
  if (/^\d+$/.test(raw)) return Number(raw)
  if (raw === 'true') return 1
  return raw
}

function resolveWebDist(env) {
  const configured = resolveRuntimePath(env.LUNA_WEB_DIST)
  if (configured) return existsSync(path.join(configured, 'index.html')) ? configured : ''
  const fallback = path.resolve(process.cwd(), '..', 'personal-luna', 'dist')
  return existsSync(path.join(fallback, 'index.html')) ? fallback : ''
}

function buildBackendChecklist({ authConfig, webDist }) {
  const configPath = resolveRuntimePath(process.env.ASSISTANT_MODE_CONFIG_FILE)
  const memoryPath = resolveRuntimePath(process.env.ASSISTANT_MEMORY_FILE)
  const checks = [
    { id: 'service-online', label: 'Service läuft', status: 'ok', details: `Uptime: ${Math.round(process.uptime())}s` },
    { id: 'assistant-route', label: 'Assistant API gemountet', status: 'ok', details: '/assistant' },
    {
      id: 'config-file',
      label: 'Mode-Config vorhanden',
      status: configPath && existsSync(configPath) ? 'ok' : 'warn',
      details: configPath || 'Nicht gesetzt',
    },
    {
      id: 'memory-dir',
      label: 'Memory-Verzeichnis vorhanden',
      status: memoryPath && existsSync(path.dirname(memoryPath)) ? 'ok' : 'warn',
      details: memoryPath || 'Nicht gesetzt',
    },
    {
      id: 'auth-mode',
      label: 'Login',
      status: authConfig.disabled ? 'warn' : 'ok',
      details: authConfig.disabled ? 'Deaktiviert (nur lokal!)' : `Admin-Passwort aktiv, Cookie ${authConfig.secureCookie ? 'secure' : 'nicht secure (nur lokal ok)'}`,
    },
    {
      id: 'web-app',
      label: 'Web-App ausgeliefert',
      status: webDist ? 'ok' : 'info',
      details: webDist ? webDist : 'Kein Build gefunden (Dev: Vite-Server nutzen)',
    },
  ]

  return {
    ok: checks.every((check) => check.status !== 'warn'),
    service: 'luna-assistant-service',
    generatedAt: new Date().toISOString(),
    checks,
  }
}

function buildDeployDiagnostics({ authConfig }) {
  const startUptimeSec = Math.round(process.uptime())
  const configPath = resolveRuntimePath(process.env.ASSISTANT_MODE_CONFIG_FILE)
  const memoryPath = resolveRuntimePath(process.env.ASSISTANT_MEMORY_FILE)
  const checks = [
    {
      id: 'cold-start-signal',
      label: 'Cold-Start Indikator',
      status: startUptimeSec < 120 ? 'warn' : 'ok',
      details: startUptimeSec < 120
        ? `Uptime ${startUptimeSec}s: kurz nach Start, höhere Latenz möglich`
        : `Uptime ${startUptimeSec}s: Dienst läuft stabil`,
      area: 'runtime',
    },
    {
      id: 'config-io',
      label: 'Config IO',
      status: configPath && existsSync(configPath) ? 'ok' : 'warn',
      details: configPath && existsSync(configPath) ? 'Config-Datei vorhanden' : 'Config-Datei fehlt oder nicht erreichbar',
      area: 'runtime',
    },
    {
      id: 'memory-path',
      label: 'Persistenzpfad',
      status: memoryPath && existsSync(path.dirname(memoryPath)) ? 'ok' : 'warn',
      details: memoryPath && existsSync(path.dirname(memoryPath))
        ? 'Memory-Verzeichnis vorhanden'
        : 'Memory-Verzeichnis fehlt, Deploy-Start kann blockieren',
      area: 'storage',
    },
    {
      id: 'cookie-secure',
      label: 'HTTPS-Cookie',
      status: authConfig.disabled || !authConfig.secureCookie ? 'info' : 'ok',
      details: authConfig.secureCookie ? 'Secure-Cookie aktiv (HTTPS erforderlich)' : 'Secure aus: nur für lokale Entwicklung',
      area: 'security',
    },
  ]

  return {
    ok: checks.every((check) => check.status !== 'warn'),
    generatedAt: new Date().toISOString(),
    checks,
    recommendations: [
      'Nur über HTTPS (Caddy oder Cloudflare Tunnel) erreichbar machen.',
      'Backups der SQLite-Datei regelmäßig ziehen.',
      'Passwort mit `npm run set-password` ändern meldet alle Geräte ab.',
    ],
  }
}

// Baut die komplette Express-App. Getrennt von server.mjs, damit Tests sie ohne Port starten können.
export async function createApp({ env = process.env, log = (line) => process.stdout.write(`${line}\n`), assistantRouter, summarize, fetchImpl } = {}) {
  const authConfig = await resolveAuthConfig(env, { log })
  const auth = createAuth(authConfig)
  const webDist = resolveWebDist(env)

  // Cockpit data (lists, money, metrics, briefings) lives in its own SQLite file.
  const cockpitDb = openCockpitDb(env.LUNA_DB_FILE === ':memory:'
    ? ':memory:'
    : resolveRuntimePath(env.LUNA_DB_FILE || './data/luna.sqlite'))
  const cockpitStore = createCockpitStore(cockpitDb)
  const secrets = createSecretStore(cockpitDb, createSecretBox(env))
  const outlook = createOutlookConnector({ env, secrets, store: cockpitStore, log, ...(fetchImpl ? { fetchImpl } : {}) })
  const tiktok = createTikTokConnector({ env, secrets, store: cockpitStore, log, ...(fetchImpl ? { fetchImpl } : {}) })
  const connectors = [outlook, tiktok]
  const briefing = createBriefingService({
    store: cockpitStore,
    env,
    log,
    mail: () => (outlook.status().connected ? outlook.summary({ force: true }) : null),
    // Refresh TikTok numbers first so the briefing's metrics are current.
    beforeRun: () => (tiktok.status().connected ? tiktok.summary({ force: true }).catch(() => null) : null),
    ...(summarize ? { summarize } : {}),
  })

  const app = express()
  app.set('trust proxy', parseTrustProxy(env.TRUST_PROXY))

  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64')
    req.requestId = crypto.randomUUID()
    next()
  })

  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", (_req, res) => `'nonce-${res.locals.cspNonce}'`],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: authConfig.secureCookie ? [] : null,
      },
    },
    strictTransportSecurity: authConfig.secureCookie,
    crossOriginEmbedderPolicy: false,
  }))
  app.use((_req, res, next) => {
    res.setHeader('Permissions-Policy', 'camera=(), geolocation=(), microphone=(self)')
    next()
  })

  app.use(express.json({ limit: '1mb' }))

  // Öffentlich: nur ein minimaler Health-Check ohne Interna.
  app.get('/health', (_req, res) => {
    res.json({ ok: true, service: 'luna-assistant-service', at: new Date().toISOString() })
  })

  app.use('/auth', csrfGuard, auth.router)

  app.use('/assistant', csrfGuard, auth.requireAuth)
  if (assistantRouter) {
    app.use('/assistant', assistantRouter)
  }

  app.use('/api/connectors', createOAuthCallbackRouter({ connectors, log }))
  app.use('/api', csrfGuard, auth.requireAuth)
  app.use('/api/connectors', createConnectorRouter({ connectors }))
  app.use('/api', createCockpitRouter({ store: cockpitStore, briefing, connectors: () => connectors.map((c) => c.status()) }))

  app.get('/backend', auth.requireAuth, (_req, res) => {
    res.type('html').send(renderStatusPage({ nonce: res.locals.cspNonce }))
  })
  app.get('/backend/checklist', auth.requireAuth, (_req, res) => {
    res.json(buildBackendChecklist({ authConfig, webDist }))
  })
  app.get('/backend/deploy-diagnostics', auth.requireAuth, (_req, res) => {
    res.json(buildDeployDiagnostics({ authConfig }))
  })

  // Die Web-App selbst ist öffentlich ladbar (enthält keine Secrets); alle Daten kommen nur nach Login.
  if (webDist) {
    app.use(express.static(webDist, { index: false, maxAge: '1h' }))
    app.get(/^\/(?!api|assistant|auth|backend|health).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache')
      res.sendFile(path.join(webDist, 'index.html'))
    })
  }

  app.use((req, res) => {
    res.status(404).json({ ok: false, error: { message: 'Not found.' } })
  })

  // Keine Stacktraces nach außen.
  app.use((error, req, res, _next) => {
    log(`[error] ${req.requestId} ${error?.stack || error}`)
    const status = Number(error?.status || error?.statusCode) || 500
    res.status(status >= 400 && status < 600 ? status : 500).json({
      ok: false,
      requestId: req.requestId,
      error: { message: status < 500 ? String(error?.message || 'Bad request') : 'Internal error.' },
    })
  })

  return { app, authConfig, cockpit: { db: cockpitDb, store: cockpitStore, briefing, outlook, tiktok, connectors } }
}
