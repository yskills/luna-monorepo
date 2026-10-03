import crypto from 'node:crypto'
import express from 'express'
import { hashPassword, parsePasswordHash, verifyPassword } from './password.mjs'
import {
  createSessionToken,
  deriveSessionKey,
  parseCookies,
  serializeCookie,
  verifySessionToken,
} from './session.mjs'
import { createLoginRateLimiter } from './loginRateLimiter.mjs'

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

const truthy = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())

function timingSafeStringEqual(a, b) {
  const left = crypto.createHash('sha256').update(String(a)).digest()
  const right = crypto.createHash('sha256').update(String(b)).digest()
  return crypto.timingSafeEqual(left, right)
}

// Liest und prüft die Auth-Konfiguration aus der Umgebung.
// Fail-closed: ohne Admin-Passwort startet der Service nicht,
// außer LUNA_AUTH_DISABLED=true ist explizit für lokale Entwicklung gesetzt.
export async function resolveAuthConfig(env = process.env, { log = () => {} } = {}) {
  const isProduction = String(env.NODE_ENV || '').trim() === 'production'
  const disabled = truthy(env.LUNA_AUTH_DISABLED)

  if (disabled) {
    if (isProduction) {
      throw new Error('LUNA_AUTH_DISABLED=true is not allowed when NODE_ENV=production.')
    }
    log('[auth] WARNUNG: Login ist deaktiviert (LUNA_AUTH_DISABLED=true). Nur lokal verwenden.')
    return { disabled: true }
  }

  let passwordHash = String(env.LUNA_ADMIN_PASSWORD_HASH || '').trim()
  const plainPassword = String(env.LUNA_ADMIN_PASSWORD || '')

  if (passwordHash) {
    if (!parsePasswordHash(passwordHash)) {
      throw new Error('LUNA_ADMIN_PASSWORD_HASH is malformed. Generate it with `npm run set-password`.')
    }
  } else if (plainPassword) {
    passwordHash = await hashPassword(plainPassword)
    log('[auth] Hinweis: LUNA_ADMIN_PASSWORD ist im Klartext gesetzt. Besser `npm run set-password` nutzen (speichert nur den Hash).')
  } else {
    throw new Error('No admin password configured. Run `npm run set-password` (writes LUNA_ADMIN_PASSWORD_HASH to .env).')
  }

  let sessionSecret = String(env.LUNA_SESSION_SECRET || '').trim()
  if (sessionSecret.length < 32) {
    if (isProduction) {
      throw new Error('LUNA_SESSION_SECRET must be set (at least 32 characters) in production. `npm run set-password` generates one.')
    }
    sessionSecret = crypto.randomBytes(32).toString('base64url')
    log('[auth] Hinweis: Kein LUNA_SESSION_SECRET gesetzt, temporäres Secret erzeugt (Logins gelten bis zum Neustart).')
  }

  const ttlDays = Number(env.LUNA_SESSION_TTL_DAYS || 30)
  const secureCookie = env.LUNA_COOKIE_SECURE != null && env.LUNA_COOKIE_SECURE !== ''
    ? truthy(env.LUNA_COOKIE_SECURE)
    : isProduction

  return {
    disabled: false,
    passwordHash,
    sessionKey: deriveSessionKey(sessionSecret, passwordHash),
    ttlMs: Math.max(1, Number.isFinite(ttlDays) ? ttlDays : 30) * 24 * 60 * 60 * 1000,
    secureCookie,
    cookieName: secureCookie ? '__Host-luna_session' : 'luna_session',
    apiKey: String(env.ASSISTANT_API_KEY || '').trim(),
  }
}

// CSRF-Schutz zusätzlich zu SameSite=Strict:
// zustandsändernde Requests müssen JSON sein und dürfen nicht von fremden Seiten kommen.
export function csrfGuard(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next()

  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase()
  if (fetchSite === 'cross-site') {
    return res.status(403).json({ ok: false, error: { message: 'Cross-site request blocked.' } })
  }

  const origin = req.get('origin')
  if (origin) {
    let originHost = ''
    try {
      originHost = new URL(origin).host
    } catch {
      originHost = ''
    }
    if (!originHost || originHost !== req.get('host')) {
      return res.status(403).json({ ok: false, error: { message: 'Origin not allowed.' } })
    }
  }

  const hasBody = Number(req.get('content-length') || 0) > 0 || !!req.get('transfer-encoding')
  if (hasBody && !req.is('application/json')) {
    return res.status(415).json({ ok: false, error: { message: 'Content-Type must be application/json.' } })
  }
  return next()
}

export function createAuth(config) {
  const limiter = createLoginRateLimiter()

  const readSession = (req) => {
    if (config.disabled) return { sid: 'auth-disabled' }
    const token = parseCookies(req.headers.cookie)[config.cookieName]
    return token ? verifySessionToken(config.sessionKey, token) : null
  }

  const hasValidApiKey = (req) => {
    if (!config.apiKey) return false
    const header = String(req.headers.authorization || '').trim()
    if (!header.startsWith('Bearer ')) return false
    return timingSafeStringEqual(header.slice(7).trim(), config.apiKey)
  }

  const requireAuth = (req, res, next) => {
    if (readSession(req) || hasValidApiKey(req)) return next()
    return res.status(401).json({ ok: false, error: { message: 'Login required.' } })
  }

  const router = express.Router()

  router.get('/me', (req, res) => {
    const session = readSession(req)
    if (!session) return res.status(401).json({ ok: false, authenticated: false })
    return res.json({ ok: true, authenticated: true, expiresAt: session.exp ? new Date(session.exp).toISOString() : null })
  })

  router.post('/login', async (req, res) => {
    if (config.disabled) return res.json({ ok: true, authenticated: true })

    const ip = req.ip || 'unknown'
    const status = limiter.check(ip)
    if (!status.allowed) {
      res.setHeader('Retry-After', String(status.retryAfterSec))
      return res.status(429).json({ ok: false, error: { message: 'Too many failed attempts. Try again later.' } })
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : ''
    const valid = password.length > 0 && password.length <= 1024 && await verifyPassword(password, config.passwordHash)
    if (!valid) {
      limiter.registerFailure(ip)
      return res.status(401).json({ ok: false, error: { message: 'Wrong password.' } })
    }

    limiter.registerSuccess(ip)
    const token = createSessionToken(config.sessionKey, { ttlMs: config.ttlMs })
    res.setHeader('Set-Cookie', serializeCookie(config.cookieName, token, {
      maxAgeSec: config.ttlMs / 1000,
      secure: config.secureCookie,
    }))
    return res.json({ ok: true, authenticated: true })
  })

  router.post('/logout', (_req, res) => {
    if (!config.disabled) {
      res.setHeader('Set-Cookie', serializeCookie(config.cookieName, '', { secure: config.secureCookie, expire: true }))
    }
    return res.json({ ok: true, authenticated: false })
  })

  return { router, requireAuth }
}
