import dotenv from 'dotenv'
import cors from 'cors'
import express from 'express'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { CompanionLLMService, createAssistantRouter } from '@luna/assistant-core/v1'

dotenv.config()

const port = Number(process.env.PORT || 5050)
const host = String(process.env.HOST || '0.0.0.0').trim()
const apiKey = String(process.env.ASSISTANT_API_KEY || '').trim()

const normalizeOrigin = (value) => String(value || '')
  .trim()
  .replace(/^['\"]+|['\"]+$/g, '')
  .replace(/\/$/, '')

const corsOriginsRaw = String(process.env.ASSISTANT_CORS_ORIGINS ?? '*').trim()
const parsedCorsOrigins = corsOriginsRaw === '*'
  ? ['*']
  : corsOriginsRaw
    .split(',')
    .map((v) => normalizeOrigin(v))
    .filter(Boolean)

const corsOrigins = parsedCorsOrigins.length > 0 ? parsedCorsOrigins : ['*']

const isCorsOriginAllowed = (requestOrigin) => {
  const normalizedRequestOrigin = normalizeOrigin(requestOrigin)
  if (!normalizedRequestOrigin) {
    return true
  }

  if (corsOrigins.includes('*')) {
    return true
  }

  return corsOrigins.includes(normalizedRequestOrigin)
}

const corsOptions = {
  origin: (origin, callback) => {
    if (isCorsOriginAllowed(origin)) {
      return callback(null, true)
    }
    return callback(null, false)
  },
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Accept', 'Origin'],
}

if (!process.env.ASSISTANT_MODE_CONFIG_FILE) {
  const localModeConfigFile = path.resolve(process.cwd(), 'config', 'assistant-mode-config.local.json')
  const exampleModeConfigFile = path.resolve(process.cwd(), 'config', 'assistant-mode-config.example.json')
  process.env.ASSISTANT_MODE_CONFIG_FILE = existsSync(localModeConfigFile)
    ? './config/assistant-mode-config.local.json'
    : './config/assistant-mode-config.example.json'

  if (!existsSync(localModeConfigFile) && !existsSync(exampleModeConfigFile)) {
    process.stdout.write('[assistant-service] Warnung: Keine Mode-Config-Datei gefunden (local/example).\n')
  }
}

if (!process.env.ASSISTANT_MEMORY_FILE) {
  process.env.ASSISTANT_MEMORY_FILE = './data/assistant-memory.sqlite'
}

const app = express()

app.use(cors(corsOptions))
app.options('*', cors(corsOptions))
app.use(express.json({ limit: '1mb' }))

if (apiKey) {
  app.use('/assistant', (req, res, next) => {
    if (req.method === 'OPTIONS') {
      return next()
    }

    const auth = String(req.headers.authorization || '').trim()
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
    if (!token || token !== apiKey) {
      return res.status(401).json({
        ok: false,
        error: { message: 'Unauthorized: invalid API key' },
      })
    }
    return next()
  })
}

app.use('/assistant', createAssistantRouter({
  CompanionLLMService,
}))

const resolveRuntimePath = (targetPath) => {
  const normalized = String(targetPath || '').trim()
  if (!normalized) {
    return ''
  }
  return path.isAbsolute(normalized)
    ? normalized
    : path.resolve(process.cwd(), normalized)
}

const buildBackendChecklist = () => {
  const configPath = resolveRuntimePath(process.env.ASSISTANT_MODE_CONFIG_FILE)
  const memoryPath = resolveRuntimePath(process.env.ASSISTANT_MEMORY_FILE)
  const checks = [
    {
      id: 'service-online',
      label: 'Service läuft',
      status: 'ok',
      details: `Uptime: ${Math.round(process.uptime())}s`,
    },
    {
      id: 'assistant-route',
      label: 'Assistant API gemountet',
      status: 'ok',
      details: '/assistant',
    },
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
      label: 'API-Key Modus',
      status: apiKey ? 'ok' : 'info',
      details: apiKey ? 'Aktiv (Bearer Token erforderlich)' : 'Deaktiviert',
    },
    {
      id: 'cors-mode',
      label: 'CORS Konfiguration',
      status: 'ok',
      details: corsOrigins.includes('*') ? 'Alle Origins erlaubt (*)' : `${corsOrigins.length} Origin(s)`,
    },
  ]

  return {
    ok: checks.every((check) => check.status !== 'warn'),
    service: 'luna-assistant-service',
    generatedAt: new Date().toISOString(),
    checks,
  }
}

const buildDeployDiagnostics = () => {
  const startUptimeSec = Math.round(process.uptime())
  const hasApiKey = !!apiKey
  const hasStrictCors = !corsOrigins.includes('*')
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
      details: configPath && existsSync(configPath)
        ? 'Config-Datei vorhanden'
        : 'Config-Datei fehlt oder nicht erreichbar',
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
      id: 'auth-overhead',
      label: 'Auth Konfiguration',
      status: hasApiKey ? 'ok' : 'info',
      details: hasApiKey
        ? 'API-Key aktiv (normaler Overhead)'
        : 'Kein API-Key aktiv',
      area: 'security',
    },
    {
      id: 'cors-scope',
      label: 'CORS Scope',
      status: hasStrictCors ? 'ok' : 'info',
      details: hasStrictCors
        ? 'Restriktive Origins gesetzt'
        : 'Wildcard CORS; praktisch für Dev, breit für Prod',
      area: 'network',
    },
  ]

  const recommendations = [
    'Container/Image klein halten und Layer-Caching aktivieren.',
    'DB-Migrationen separat oder vor dem Traffic-Switch ausführen.',
    'CI-Schritte parallelisieren und Artefakte zwischen Jobs cachen.',
    'Readiness/Liveness-Probes getrennt konfigurieren, um Rollout-Blocker zu vermeiden.',
  ]

  return {
    ok: checks.every((check) => check.status !== 'warn'),
    generatedAt: new Date().toISOString(),
    checks,
    recommendations,
  }
}

const renderLandingPage = () => `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Luna Assistant Backend</title>
  <style>
    :root {
      color-scheme: light dark;
      --bg: #0b1020;
      --panel: #141b34;
      --panel-soft: #1b2446;
      --text: #e6ebff;
      --muted: #9aa7d6;
      --ok: #39d98a;
      --warn: #ffbe4d;
      --info: #63a4ff;
      --danger: #ff6b6b;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Inter, Segoe UI, Arial, sans-serif;
      background: radial-gradient(circle at 20% 0%, #1a2550, var(--bg) 45%);
      color: var(--text);
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(900px, 100%);
      background: linear-gradient(180deg, var(--panel), var(--panel-soft));
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.35);
      padding: 24px;
    }
    h1 { margin: 0 0 8px; font-size: 1.6rem; }
    .subtitle { margin: 0 0 20px; color: var(--muted); }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 10px;
      margin-bottom: 20px;
    }
    .meta-item {
      background: rgba(255, 255, 255, 0.04);
      border-radius: 10px;
      padding: 10px 12px;
      font-size: 0.9rem;
      color: var(--muted);
    }
    .meta-item strong {
      display: block;
      color: var(--text);
      margin-bottom: 4px;
    }
    .actions {
      display: flex;
      gap: 10px;
      margin-bottom: 20px;
    }
    button {
      border: 0;
      border-radius: 10px;
      background: #2e5cff;
      color: white;
      padding: 10px 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:disabled { opacity: 0.6; cursor: not-allowed; }
    .status-line {
      margin: 0 0 14px;
      color: var(--muted);
      font-size: 0.95rem;
    }
    .checklist {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: 8px;
    }
    .check-item {
      display: grid;
      grid-template-columns: 28px 1fr auto;
      align-items: center;
      gap: 10px;
      background: rgba(255, 255, 255, 0.035);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .badge { font-weight: 700; font-size: 0.9rem; }
    .ok { color: var(--ok); }
    .warn { color: var(--warn); }
    .info { color: var(--info); }
    .danger { color: var(--danger); }
    .label { font-weight: 600; }
    .details { color: var(--muted); font-size: 0.9rem; }
    .pill {
      font-size: 0.8rem;
      border-radius: 999px;
      padding: 4px 8px;
      background: rgba(255, 255, 255, 0.08);
      color: var(--muted);
    }
  </style>
</head>
<body>
  <main class="card">
    <h1>Luna Backend Status</h1>
    <p class="subtitle">Schnelle Live-Checks für deinen Assistant-Service.</p>
    <div class="meta">
      <div class="meta-item"><strong>Service</strong><span id="serviceName">-</span></div>
      <div class="meta-item"><strong>Host</strong><span id="hostName">-</span></div>
      <div class="meta-item"><strong>Letzter Lauf</strong><span id="lastRun">-</span></div>
    </div>
    <div class="actions">
      <button id="runChecksBtn">Checks ausführen</button>
    </div>
    <p class="status-line" id="statusLine">Bereit.</p>
    <ul class="checklist" id="checklist"></ul>
    <p class="status-line" style="margin-top:16px;">Deploy Diagnose</p>
    <ul class="checklist" id="deployList"></ul>
  </main>

  <script>
    const checklistEl = document.getElementById('checklist')
    const statusLineEl = document.getElementById('statusLine')
    const serviceNameEl = document.getElementById('serviceName')
    const hostNameEl = document.getElementById('hostName')
    const lastRunEl = document.getElementById('lastRun')
    const runChecksBtn = document.getElementById('runChecksBtn')
    const deployListEl = document.getElementById('deployList')

    hostNameEl.textContent = window.location.origin

    const iconByStatus = {
      ok: '✓',
      warn: '!',
      info: 'i',
      danger: 'x'
    }

    const pushItem = (label, status, details, source) => ({
      label,
      status,
      details,
      source
    })

    const renderItems = (items) => {
      checklistEl.innerHTML = ''
      for (const item of items) {
        const li = document.createElement('li')
        li.className = 'check-item'
        li.innerHTML =
          '<span class="badge ' + item.status + '">' + (iconByStatus[item.status] || '?') + '</span>' +
          '<div><div class="label">' + item.label + '</div><div class="details">' + item.details + '</div></div>' +
          '<span class="pill">' + item.source + '</span>'
        checklistEl.appendChild(li)
      }
    }

    const renderDeployItems = (items) => {
      deployListEl.innerHTML = ''
      for (const item of items) {
        const li = document.createElement('li')
        li.className = 'check-item'
        li.innerHTML =
          '<span class="badge ' + item.status + '">' + (iconByStatus[item.status] || '?') + '</span>' +
          '<div><div class="label">' + item.label + '</div><div class="details">' + item.details + '</div></div>' +
          '<span class="pill">' + item.source + '</span>'
        deployListEl.appendChild(li)
      }
    }

    const fetchWithTimeout = async (url, options = {}, timeoutMs = 3500) => {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), timeoutMs)
      try {
        return await fetch(url, { ...options, signal: controller.signal, cache: 'no-store' })
      } finally {
        clearTimeout(timer)
      }
    }

    const runChecks = async () => {
      runChecksBtn.disabled = true
      statusLineEl.textContent = 'Prüfe Backend...'
      const items = []

      const [healthResult, checklistResult, assistantResult, deployResult] = await Promise.allSettled([
        fetchWithTimeout('/health').then(async (res) => ({ statusCode: res.status, body: res.ok ? await res.json() : null })),
        fetchWithTimeout('/backend/checklist').then(async (res) => ({ statusCode: res.status, body: res.ok ? await res.json() : null })),
        fetchWithTimeout('/assistant', { method: 'OPTIONS' }).then((res) => ({ statusCode: res.status })),
        fetchWithTimeout('/backend/deploy-diagnostics').then(async (res) => ({ statusCode: res.status, body: res.ok ? await res.json() : null })),
      ])

      if (healthResult.status === 'fulfilled') {
        if (healthResult.value.statusCode === 200) {
          const health = healthResult.value.body || {}
          serviceNameEl.textContent = health.service || 'luna-assistant-service'
          items.push(pushItem('Health Endpoint erreichbar', 'ok', '/health antwortet mit 200', 'health'))
        } else {
          items.push(pushItem('Health Endpoint erreichbar', 'danger', 'HTTP ' + healthResult.value.statusCode, 'health'))
        }
      } else {
        items.push(pushItem('Health Endpoint erreichbar', 'danger', String(healthResult.reason && healthResult.reason.message || healthResult.reason), 'health'))
      }

      if (checklistResult.status === 'fulfilled') {
        if (checklistResult.value.statusCode === 200) {
          const payload = checklistResult.value.body || {}
          serviceNameEl.textContent = payload.service || serviceNameEl.textContent
          for (const check of payload.checks || []) {
            const mappedStatus = check.status === 'ok' || check.status === 'warn' || check.status === 'info' ? check.status : 'danger'
            items.push(pushItem(check.label, mappedStatus, check.details || '-', 'backend'))
          }
        } else {
          items.push(pushItem('Backend-Checklist geladen', 'danger', 'HTTP ' + checklistResult.value.statusCode, 'backend'))
        }
      } else {
        items.push(pushItem('Backend-Checklist geladen', 'danger', String(checklistResult.reason && checklistResult.reason.message || checklistResult.reason), 'backend'))
      }

      if (assistantResult.status === 'fulfilled') {
        const reachable = assistantResult.value.statusCode < 500
        items.push(pushItem('Assistant Route erreichbar', reachable ? 'ok' : 'danger', 'OPTIONS /assistant HTTP ' + assistantResult.value.statusCode, 'assistant'))
      } else {
        items.push(pushItem('Assistant Route erreichbar', 'danger', String(assistantResult.reason && assistantResult.reason.message || assistantResult.reason), 'assistant'))
      }

      const deployItems = []
      if (deployResult.status === 'fulfilled') {
        if (deployResult.value.statusCode === 200) {
          const payload = deployResult.value.body || {}
          for (const check of payload.checks || []) {
            const mappedStatus = check.status === 'ok' || check.status === 'warn' || check.status === 'info' ? check.status : 'danger'
            deployItems.push(pushItem(check.label, mappedStatus, check.details || '-', check.area || 'deploy'))
          }
          for (const rec of payload.recommendations || []) {
            deployItems.push(pushItem('Empfehlung', 'info', rec, 'hint'))
          }
        } else {
          deployItems.push(pushItem('Deploy-Diagnose geladen', 'danger', 'HTTP ' + deployResult.value.statusCode, 'deploy'))
        }
      } else {
        deployItems.push(pushItem('Deploy-Diagnose geladen', 'danger', String(deployResult.reason && deployResult.reason.message || deployResult.reason), 'deploy'))
      }

      const hasDanger = items.some((item) => item.status === 'danger')
      const hasWarn = items.some((item) => item.status === 'warn')
      statusLineEl.textContent = hasDanger
        ? 'Mindestens ein kritischer Check fehlgeschlagen.'
        : hasWarn
          ? 'Checks abgeschlossen, mit Warnungen.'
          : 'Alle Checks erfolgreich.'

      lastRunEl.textContent = new Date().toLocaleString('de-DE')
      renderItems(items)
      renderDeployItems(deployItems)
      runChecksBtn.disabled = false
    }

    runChecksBtn.addEventListener('click', runChecks)
    runChecks()
  </script>
</body>
</html>`

app.get('/', (_req, res) => {
  res.type('html').send(renderLandingPage())
})

app.get('/backend/checklist', (_req, res) => {
  res.json(buildBackendChecklist())
})

app.get('/backend/deploy-diagnostics', (_req, res) => {
  res.json(buildDeployDiagnostics())
})

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'luna-assistant-service',
    apiMountedAt: '/assistant',
    authEnabled: !!apiKey,
    at: new Date().toISOString(),
  })
})

app.listen(port, host, () => {
  const localHost = host === '0.0.0.0' ? '127.0.0.1' : host
  process.stdout.write(`Luna Assistant Service läuft auf http://${host}:${port}\n`)
  process.stdout.write(`Lokal erreichbar unter: http://${localHost}:${port}\n`)
  process.stdout.write(`API Basis: http://${localHost}:${port}/assistant\n`)
})
