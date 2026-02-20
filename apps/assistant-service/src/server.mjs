import dotenv from 'dotenv'
import cors from 'cors'
import { createAssistantServiceApp } from '@luna/assistant-core/v1'

dotenv.config()

const port = Number(process.env.PORT || 5050)
const host = String(process.env.HOST || '0.0.0.0').trim()
const apiKey = String(process.env.ASSISTANT_API_KEY || '').trim()
const corsOriginsRaw = String(process.env.ASSISTANT_CORS_ORIGINS || '*').trim()
const corsOrigins = corsOriginsRaw === '*'
  ? '*'
  : corsOriginsRaw.split(',').map((v) => v.trim()).filter(Boolean)

if (!process.env.ASSISTANT_MODE_CONFIG_FILE) {
  process.env.ASSISTANT_MODE_CONFIG_FILE = './config/assistant-mode-config.local.json'
}

if (!process.env.ASSISTANT_MEMORY_FILE) {
  process.env.ASSISTANT_MEMORY_FILE = './data/assistant-memory.sqlite'
}

const app = createAssistantServiceApp({
  enableCors: false,
  mountPath: '/assistant',
})

app.use(cors({
  origin: corsOrigins,
  credentials: true,
}))

if (apiKey) {
  app.use('/assistant', (req, res, next) => {
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
  process.stdout.write(`Luna Assistant Service läuft auf http://${host}:${port}\n`)
  process.stdout.write(`API Basis: http://${host}:${port}/assistant\n`)
})
