import crypto from 'node:crypto'

// Zustandslose, HMAC-signierte Session-Cookies.
// Der Signaturschlüssel wird aus LUNA_SESSION_SECRET + Passwort-Hash abgeleitet:
// Passwort ändern oder Secret rotieren meldet alle Geräte sofort ab.

const SESSION_VERSION = 1

const toBase64Url = (value) => Buffer.from(value).toString('base64url')

export function deriveSessionKey(sessionSecret, passwordHash) {
  return Buffer.from(crypto.hkdfSync('sha256', String(sessionSecret), String(passwordHash), 'luna-session-v1', 32))
}

function sign(key, payloadB64) {
  return crypto.createHmac('sha256', key).update(payloadB64).digest('base64url')
}

export function createSessionToken(key, { ttlMs, now = Date.now() } = {}) {
  const payload = {
    v: SESSION_VERSION,
    sid: crypto.randomBytes(16).toString('base64url'),
    iat: now,
    exp: now + ttlMs,
  }
  const payloadB64 = toBase64Url(JSON.stringify(payload))
  return `${payloadB64}.${sign(key, payloadB64)}`
}

export function verifySessionToken(key, token, { now = Date.now() } = {}) {
  const [payloadB64, signature, extra] = String(token || '').split('.')
  if (!payloadB64 || !signature || extra !== undefined) return null

  const expected = Buffer.from(sign(key, payloadB64))
  const actual = Buffer.from(signature)
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return null

  let payload
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (payload?.v !== SESSION_VERSION || !Number.isFinite(payload.exp) || payload.exp <= now) return null
  return payload
}

export function parseCookies(header) {
  const cookies = {}
  for (const part of String(header || '').split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name && !(name in cookies)) cookies[name] = value
  }
  return cookies
}

export function serializeCookie(name, value, { maxAgeSec, secure, expire = false } = {}) {
  const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict']
  if (secure) parts.push('Secure')
  parts.push(expire ? 'Max-Age=0' : `Max-Age=${Math.floor(maxAgeSec)}`)
  return parts.join('; ')
}
