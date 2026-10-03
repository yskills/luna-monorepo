import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { createApp } from '../src/app.mjs'
import { hashPassword, verifyPassword } from '../src/security/password.mjs'
import { createSessionToken, deriveSessionKey, verifySessionToken } from '../src/security/session.mjs'
import { createLoginRateLimiter } from '../src/security/loginRateLimiter.mjs'

const PASSWORD = 'correct horse battery staple'
let passwordHash

test.before(async () => {
  passwordHash = await hashPassword(PASSWORD)
})

async function startApp(envOverrides = {}) {
  const assistantRouter = express.Router()
  assistantRouter.get('/ping', (_req, res) => res.json({ ok: true, pong: true }))
  assistantRouter.post('/echo', (req, res) => res.json({ ok: true, body: req.body }))

  const { app } = await createApp({
    env: {
      LUNA_ADMIN_PASSWORD_HASH: passwordHash,
      LUNA_SESSION_SECRET: 'x'.repeat(48),
      LUNA_WEB_DIST: '/nonexistent',
      LUNA_DB_FILE: ':memory:',
      ...envOverrides,
    },
    log: () => {},
    assistantRouter,
  })

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  return { baseUrl, stop: () => new Promise((resolve) => server.close(resolve)) }
}

const login = (baseUrl, password, headers = {}) => fetch(`${baseUrl}/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ password }),
})

const sessionCookieFrom = (response) => String(response.headers.get('set-cookie') || '').split(';')[0]

test('password hashing: scrypt hash verifies only the right password', async () => {
  assert.match(passwordHash, /^scrypt:131072:8:1:/)
  assert.equal(passwordHash.includes('$'), false)
  assert.equal(await verifyPassword(PASSWORD, passwordHash), true)
  assert.equal(await verifyPassword('wrong password!!', passwordHash), false)
  await assert.rejects(() => hashPassword('short'), /12 characters/)
})

test('session tokens: tampered, expired or foreign-key tokens are rejected', () => {
  const key = deriveSessionKey('s'.repeat(40), passwordHash)
  const token = createSessionToken(key, { ttlMs: 60_000 })
  assert.ok(verifySessionToken(key, token))

  const [payload, signature] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ v: 1, sid: 'x', iat: 0, exp: Date.now() + 1e9 })).toString('base64url')
  assert.equal(verifySessionToken(key, `${forged}.${signature}`), null)
  assert.equal(verifySessionToken(key, `${payload}.AAAA`), null)
  assert.equal(verifySessionToken(key, token, { now: Date.now() + 120_000 }), null)

  // Passwortwechsel => anderer Schlüssel => alte Sessions ungültig
  const otherKey = deriveSessionKey('s'.repeat(40), `${passwordHash}x`)
  assert.equal(verifySessionToken(otherKey, token), null)
})

test('startup fails closed without password, and refuses disabled auth in production', async () => {
  await assert.rejects(() => createApp({ env: {}, log: () => {} }), /No admin password/)
  await assert.rejects(
    () => createApp({ env: { LUNA_AUTH_DISABLED: 'true', NODE_ENV: 'production' }, log: () => {} }),
    /not allowed/,
  )
  await assert.rejects(
    () => createApp({ env: { LUNA_ADMIN_PASSWORD_HASH: passwordHash, NODE_ENV: 'production' }, log: () => {} }),
    /LUNA_SESSION_SECRET/,
  )
})

test('API requires login; correct password sets a hardened session cookie', async () => {
  const { baseUrl, stop } = await startApp()
  try {
    assert.equal((await fetch(`${baseUrl}/assistant/ping`)).status, 401)
    assert.equal((await fetch(`${baseUrl}/backend/checklist`)).status, 401)
    assert.equal((await fetch(`${baseUrl}/health`)).status, 200)

    const wrong = await login(baseUrl, 'not the password')
    assert.equal(wrong.status, 401)
    assert.equal(wrong.headers.get('set-cookie'), null)

    const ok = await login(baseUrl, PASSWORD)
    assert.equal(ok.status, 200)
    const setCookie = ok.headers.get('set-cookie')
    assert.match(setCookie, /HttpOnly/)
    assert.match(setCookie, /SameSite=Strict/)

    const cookie = sessionCookieFrom(ok)
    const ping = await fetch(`${baseUrl}/assistant/ping`, { headers: { Cookie: cookie } })
    assert.equal(ping.status, 200)
    assert.equal((await ping.json()).pong, true)

    const me = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } })
    assert.equal((await me.json()).authenticated, true)
  } finally {
    await stop()
  }
})

test('production cookie uses __Host- prefix and Secure; security headers are set', async () => {
  const { baseUrl, stop } = await startApp({ NODE_ENV: 'production' })
  try {
    const ok = await login(baseUrl, PASSWORD)
    const setCookie = ok.headers.get('set-cookie')
    assert.match(setCookie, /^__Host-luna_session=/)
    assert.match(setCookie, /Secure/)

    const health = await fetch(`${baseUrl}/health`)
    assert.match(health.headers.get('content-security-policy'), /default-src 'self'/)
    assert.match(health.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.ok(health.headers.get('strict-transport-security'))
    assert.equal(health.headers.get('x-powered-by'), null)
    assert.equal(health.headers.get('access-control-allow-origin'), null)
  } finally {
    await stop()
  }
})

test('CSRF: cross-site and foreign-origin writes are blocked, non-JSON bodies rejected', async () => {
  const { baseUrl, stop } = await startApp()
  try {
    const cookie = sessionCookieFrom(await login(baseUrl, PASSWORD))
    const post = (headers, body = '{"a":1}') => fetch(`${baseUrl}/assistant/echo`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json', ...headers },
      body,
    })

    assert.equal((await post({})).status, 200)
    assert.equal((await post({ Origin: 'https://evil.example' })).status, 403)
    assert.equal((await post({ 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.equal((await post({ 'Content-Type': 'text/plain' }, 'a=1')).status, 415)

    const sameOrigin = new URL(baseUrl).host
    assert.equal((await post({ Origin: `http://${sameOrigin}` })).status, 200)
  } finally {
    await stop()
  }
})

test('login brute force is rate limited per IP', async () => {
  const { baseUrl, stop } = await startApp()
  try {
    for (let i = 0; i < 5; i += 1) {
      assert.equal((await login(baseUrl, `wrong-${i}-password`)).status, 401)
    }
    const blocked = await login(baseUrl, PASSWORD)
    assert.equal(blocked.status, 429)
    assert.ok(Number(blocked.headers.get('retry-after')) > 0)
  } finally {
    await stop()
  }
})

test('rate limiter: global cap stops distributed guessing', () => {
  let now = 0
  const limiter = createLoginRateLimiter({ maxPerIp: 5, maxGlobal: 3, windowMs: 1000, now: () => now })
  limiter.registerFailure('a')
  limiter.registerFailure('b')
  limiter.registerFailure('c')
  assert.equal(limiter.check('d').allowed, false)
  now = 2000
  assert.equal(limiter.check('d').allowed, true)
})

test('X-Forwarded-For is ignored unless TRUST_PROXY is configured', async () => {
  const { baseUrl, stop } = await startApp()
  try {
    for (let i = 0; i < 5; i += 1) {
      await login(baseUrl, 'wrong password', { 'X-Forwarded-For': `10.0.0.${i}` })
    }
    assert.equal((await login(baseUrl, PASSWORD, { 'X-Forwarded-For': '10.9.9.9' })).status, 429)
  } finally {
    await stop()
  }
})

test('optional server-to-server bearer key works and is compared safely', async () => {
  const { baseUrl, stop } = await startApp({ ASSISTANT_API_KEY: 'k'.repeat(40) })
  try {
    const ok = await fetch(`${baseUrl}/assistant/ping`, { headers: { Authorization: `Bearer ${'k'.repeat(40)}` } })
    assert.equal(ok.status, 200)
    const bad = await fetch(`${baseUrl}/assistant/ping`, { headers: { Authorization: 'Bearer nope' } })
    assert.equal(bad.status, 401)
  } finally {
    await stop()
  }
})
