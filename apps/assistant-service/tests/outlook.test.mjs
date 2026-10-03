import test from 'node:test'
import assert from 'node:assert/strict'
import { openCockpitDb } from '../src/cockpit/db.mjs'
import { createCockpitStore } from '../src/cockpit/store.mjs'
import { createSecretBox, createSecretStore } from '../src/connectors/secretBox.mjs'
import { createOutlookConnector, startOfDayInZone } from '../src/connectors/outlook.mjs'

const ENV = {
  LUNA_SESSION_SECRET: 's'.repeat(48),
  OUTLOOK_CLIENT_ID: 'client-id',
  OUTLOOK_CLIENT_SECRET: 'client-secret',
  OUTLOOK_REDIRECT_URI: 'https://luna.example/api/connectors/outlook/callback',
  LUNA_TIMEZONE: 'Europe/Berlin',
}

function fakeMicrosoft() {
  const calls = []
  let tokenCounter = 0
  let refreshError = null
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).endsWith('/token')) {
      const params = new URLSearchParams(init.body)
      if (params.get('grant_type') === 'refresh_token' && refreshError) return json({ error: refreshError }, 400)
      tokenCounter += 1
      return json({ access_token: `access-${tokenCounter}`, refresh_token: `refresh-${tokenCounter}`, expires_in: 3600 })
    }
    if (String(url).includes('/me?')) return json({ mail: 'me@outlook.com' })
    if (String(url).includes('/mailFolders/inbox?')) return json({ unreadItemCount: 7 })
    if (String(url).includes('/messages?')) {
      return json({ value: [{ subject: 'Rechnung   Oktober', from: { emailAddress: { name: 'Bank' } }, receivedDateTime: '2026-10-03T05:00:00Z', importance: 'high' }] })
    }
    if (String(url).includes('/calendarView?')) {
      return json({ value: [{ subject: 'Zahnarzt', start: { dateTime: '2026-10-03T10:00:00.0000000' }, end: { dateTime: '2026-10-03T11:00:00.0000000' }, isAllDay: false }] })
    }
    return json({}, 404)
  }
  return { fetchImpl, calls, failRefreshWith: (code) => { refreshError = code } }
}

function setup(env = ENV) {
  const db = openCockpitDb(':memory:')
  const store = createCockpitStore(db)
  const secrets = createSecretStore(db, createSecretBox(env))
  const ms = fakeMicrosoft()
  let clock = new Date('2026-10-03T06:00:00Z')
  const outlook = createOutlookConnector({ env, secrets, store, fetchImpl: ms.fetchImpl, now: () => clock })
  return { db, store, secrets, ms, outlook, advance: (ms_) => { clock = new Date(clock.getTime() + ms_) } }
}

test('secret box: round trip, tamper detection, wrong key', () => {
  const box = createSecretBox({ LUNA_TOKEN_KEY: 'k'.repeat(40) })
  const sealed = box.seal({ refreshToken: 'abc' })
  assert.equal(sealed.includes('abc'), false)
  assert.deepEqual(box.open(sealed), { refreshToken: 'abc' })
  const parts = sealed.split('.')
  parts[3] = parts[3].slice(0, -2) + (parts[3].endsWith('AA') ? 'BB' : 'AA')
  assert.throws(() => box.open(parts.join('.')))
  assert.throws(() => createSecretBox({ LUNA_TOKEN_KEY: 'x'.repeat(40) }).open(sealed))
  assert.equal(createSecretBox({}), null)
})

test('outlook: not configured means no connect', () => {
  const { outlook } = setup({ LUNA_SESSION_SECRET: 's'.repeat(48) })
  assert.deepEqual(outlook.status(), { id: 'outlook', label: 'Outlook', configured: false, connected: false, account: null })
  assert.throws(() => outlook.beginAuth(), /not configured/)
})

test('outlook: PKCE auth flow stores encrypted tokens and rejects reused state', async () => {
  const { outlook, ms, db } = setup()
  const url = new URL(outlook.beginAuth())
  assert.equal(url.origin + url.pathname, 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize')
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.match(url.searchParams.get('scope'), /Mail\.Read/)
  assert.doesNotMatch(url.searchParams.get('scope'), /Send|ReadWrite/)
  const state = url.searchParams.get('state')

  await assert.rejects(() => outlook.completeAuth({ code: 'c', state: 'forged' }), /expired or invalid/)
  await outlook.completeAuth({ code: 'the-code', state })
  const tokenCall = new URLSearchParams(ms.calls.find((c) => c.url.endsWith('/token')).init.body)
  assert.equal(tokenCall.get('code'), 'the-code')
  assert.ok(tokenCall.get('code_verifier').length >= 43)

  assert.deepEqual(outlook.status(), { id: 'outlook', label: 'Outlook', configured: true, connected: true, account: 'me@outlook.com' })
  const raw = db.prepare('SELECT ciphertext FROM connector_secrets').get().ciphertext
  assert.equal(raw.includes('refresh-1'), false)
  await assert.rejects(() => outlook.completeAuth({ code: 'again', state }), /expired or invalid/)
})

test('outlook: summary, caching, token refresh and revoked consent', async () => {
  const { outlook, ms, store, advance } = setup()
  const state = new URL(outlook.beginAuth()).searchParams.get('state')
  await outlook.completeAuth({ code: 'x', state })

  const summary = await outlook.summary()
  assert.equal(summary.unreadCount, 7)
  assert.deepEqual(summary.unread[0], { subject: 'Rechnung Oktober', from: 'Bank', receivedAt: '2026-10-03T05:00:00Z', important: true })
  assert.equal(summary.events[0].subject, 'Zahnarzt')
  assert.equal(store.metricsWithChange()[0].value, 7)
  const calendarCall = ms.calls.find((c) => c.url.includes('/calendarView?'))
  assert.match(decodeURIComponent(calendarCall.url), /startDateTime=2026-10-02T22:00:00.000Z/)
  assert.equal(calendarCall.init.headers.Prefer, 'outlook.timezone="Europe/Berlin"')
  assert.equal(calendarCall.init.headers.Authorization, 'Bearer access-1')

  const before = ms.calls.length
  await outlook.summary()
  assert.equal(ms.calls.length, before, 'second call within a minute is cached')

  advance(2 * 60 * 60 * 1000)
  await outlook.summary()
  assert.ok(ms.calls.some((c) => c.url.endsWith('/token') && new URLSearchParams(c.init.body).get('refresh_token') === 'refresh-1'))
  assert.equal(ms.calls.at(-1).init.headers.Authorization, 'Bearer access-2')

  advance(2 * 60 * 60 * 1000)
  ms.failRefreshWith('invalid_grant')
  await assert.rejects(() => outlook.summary(), /invalid_grant/)
  assert.equal(outlook.status().connected, false)
})

test('timezone helper: Berlin midnight in summer and winter', () => {
  assert.equal(startOfDayInZone(new Date('2026-10-03T06:00:00Z'), 'Europe/Berlin').toISOString(), '2026-10-02T22:00:00.000Z')
  assert.equal(startOfDayInZone(new Date('2026-12-24T23:30:00Z'), 'Europe/Berlin').toISOString(), '2026-12-24T23:00:00.000Z')
})

test('api: start needs login, callback is public but state-bound, briefing includes mail', async () => {
  const { createApp } = await import('../src/app.mjs')
  const { hashPassword } = await import('../src/security/password.mjs')
  const ms = fakeMicrosoft()
  const { app } = await createApp({
    env: { ...ENV, LUNA_ADMIN_PASSWORD_HASH: await hashPassword('correct horse battery staple'), LUNA_WEB_DIST: '/nonexistent', LUNA_DB_FILE: ':memory:' },
    log: () => {},
    summarize: async () => { throw new Error('offline') },
    fetchImpl: ms.fetchImpl,
  })
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    assert.equal((await fetch(`${base}/api/connectors/outlook/start`, { redirect: 'manual' })).status, 401)
    const forged = await fetch(`${base}/api/connectors/outlook/callback?code=x&state=forged`, { redirect: 'manual' })
    assert.equal(forged.headers.get('location'), '/?connect=outlook-failed')

    const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'correct horse battery staple' }) })
    const cookie = String(login.headers.get('set-cookie')).split(';')[0]
    const start = await fetch(`${base}/api/connectors/outlook/start`, { headers: { cookie }, redirect: 'manual' })
    assert.equal(start.status, 303)
    const state = new URL(start.headers.get('location')).searchParams.get('state')

    const callback = await fetch(`${base}/api/connectors/outlook/callback?code=abc&state=${state}`, { redirect: 'manual' })
    assert.equal(callback.headers.get('location'), '/?connect=outlook-ok')

    const dashboard = await (await fetch(`${base}/api/dashboard`, { headers: { cookie } })).json()
    assert.equal(dashboard.connectors[0].connected, true)
    const { briefing } = await (await fetch(`${base}/api/briefing/run`, { method: 'POST', headers: { cookie } })).json()
    assert.equal(briefing.facts.mail.unreadCount, 7)
    assert.match(briefing.summary, /Ungelesene Mails: 7\./)
    assert.match(briefing.summary, /Termine heute: 10:00 Zahnarzt\./)

    const off = await (await fetch(`${base}/api/connectors/outlook/disconnect`, { method: 'POST', headers: { cookie } })).json()
    assert.equal(off.removed, true)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
