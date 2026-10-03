import test from 'node:test'
import assert from 'node:assert/strict'
import { openCockpitDb } from '../src/cockpit/db.mjs'
import { createCockpitStore } from '../src/cockpit/store.mjs'
import { renderPlainSummary, collectFacts } from '../src/cockpit/briefing.mjs'
import { createSecretBox, createSecretStore } from '../src/connectors/secretBox.mjs'
import { createTikTokConnector } from '../src/connectors/tiktok.mjs'
import { syncConnectors } from '../src/connectors/routes.mjs'

const ENV = {
  LUNA_SESSION_SECRET: 's'.repeat(48),
  TIKTOK_CLIENT_KEY: 'ck',
  TIKTOK_CLIENT_SECRET: 'cs',
  TIKTOK_REDIRECT_URI: 'https://luna.example/api/connectors/tiktok/callback',
}

export function fakeTikTok() {
  const calls = []
  let n = 0
  let followers = 1000
  let refreshError = null
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body })
  const fetchImpl = async (url, init = {}) => {
    url = String(url)
    calls.push({ url, init })
    if (url.endsWith('/oauth/token/')) {
      const params = new URLSearchParams(init.body)
      if (params.get('grant_type') === 'refresh_token' && refreshError) return json({ error: refreshError }, 400)
      n += 1
      return json({ access_token: `act.${n}`, refresh_token: `rft.${n}`, expires_in: 86400, scope: 'user.info.basic,user.info.stats,video.list' })
    }
    if (url.endsWith('/oauth/revoke/')) return json({})
    if (url.includes('/user/info/')) {
      return json({ data: { user: { display_name: 'yskills', follower_count: followers, following_count: 50, likes_count: 9000, video_count: 42 } }, error: { code: 'ok' } })
    }
    if (url.includes('/video/list/')) {
      return json({ data: { videos: [
        { id: '1', title: 'Neues Video', create_time: 1791000000, view_count: 1500, like_count: 120, comment_count: 8, share_count: 3 },
        { id: '2', title: '', create_time: 1790000000, view_count: 500, like_count: 20, comment_count: 1, share_count: 0 },
      ], has_more: false }, error: { code: 'ok' } })
    }
    return json({ error: { code: 'not_found' } }, 404)
  }
  return { fetchImpl, calls, setFollowers: (v) => { followers = v }, failRefreshWith: (c) => { refreshError = c } }
}

function setup(env = ENV) {
  const db = openCockpitDb(':memory:')
  const store = createCockpitStore(db)
  const secrets = createSecretStore(db, createSecretBox(env))
  const tt = fakeTikTok()
  let clock = new Date('2026-10-03T06:00:00Z')
  const tiktok = createTikTokConnector({ env, secrets, store, fetchImpl: tt.fetchImpl, now: () => clock })
  return { store, tiktok, tt, advance: (ms) => { clock = new Date(clock.getTime() + ms) } }
}

test('tiktok: auth URL asks only for read scopes and state is single-use', async () => {
  const { tiktok, tt } = setup()
  const url = new URL(tiktok.beginAuth())
  assert.equal(url.origin + url.pathname, 'https://www.tiktok.com/v2/auth/authorize/')
  assert.equal(url.searchParams.get('scope'), 'user.info.basic,user.info.stats,video.list')
  assert.doesNotMatch(url.searchParams.get('scope'), /publish|upload/)
  const state = url.searchParams.get('state')
  await assert.rejects(() => tiktok.completeAuth({ code: 'c', state: 'nope' }), /expired or invalid/)
  await tiktok.completeAuth({ code: 'c', state })
  assert.deepEqual(tiktok.status(), { id: 'tiktok', label: 'TikTok', configured: true, connected: true, account: 'yskills' })
  const tokenBody = new URLSearchParams(tt.calls.find((c) => c.url.endsWith('/oauth/token/')).init.body)
  assert.equal(tokenBody.get('client_key'), 'ck')
  assert.equal(tokenBody.get('redirect_uri'), ENV.TIKTOK_REDIRECT_URI)
  await assert.rejects(() => tiktok.completeAuth({ code: 'c', state }), /expired or invalid/)
})

test('tiktok: summary stores metrics, 24h trend shows in the briefing', async () => {
  const { tiktok, tt, store, advance } = setup()
  await tiktok.completeAuth({ code: 'c', state: new URL(tiktok.beginAuth()).searchParams.get('state') })

  const first = await tiktok.summary()
  assert.equal(first.followers, 1000)
  assert.equal(first.recentViews, 2000)
  assert.equal(first.recent[1].title, '(ohne Titel)')
  const listCall = tt.calls.find((c) => c.url.includes('/video/list/'))
  assert.equal(listCall.init.method, 'POST')
  assert.deepEqual(JSON.parse(listCall.init.body), { max_count: 10 })

  // Real clock is used for metric timestamps, so record the earlier point explicitly.
  store.recordMetric('tiktok', 'followers', 950, new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString())
  advance(25 * 60 * 60 * 1000)
  tt.setFollowers(1012)
  await syncConnectors([tiktok])
  const followers = store.metricsWithChange().find((m) => m.metric === 'followers')
  assert.equal(followers.value, 1012)
  assert.equal(followers.change24h, 62)
  assert.ok(tt.calls.some((c) => c.url.endsWith('/oauth/token/') && new URLSearchParams(c.init.body).get('grant_type') === 'refresh_token'))
  assert.match(renderPlainSummary(collectFacts(store), 'de'), /TikTok-Follower: 1.012 \(\+62 in 24h\)\./)
})

test('tiktok: revoked grant disconnects, disconnect revokes at TikTok', async () => {
  const { tiktok, tt, advance } = setup()
  await tiktok.completeAuth({ code: 'c', state: new URL(tiktok.beginAuth()).searchParams.get('state') })
  assert.equal(await tiktok.disconnect(), true)
  assert.ok(tt.calls.some((c) => c.url.endsWith('/oauth/revoke/')))
  assert.equal(tiktok.status().connected, false)

  await tiktok.completeAuth({ code: 'c', state: new URL(tiktok.beginAuth()).searchParams.get('state') })
  advance(2 * 24 * 60 * 60 * 1000)
  tt.failRefreshWith('invalid_grant')
  await assert.rejects(() => tiktok.summary(), /invalid_grant/)
  assert.equal(tiktok.status().connected, false)
})

test('tiktok: not configured', () => {
  const { tiktok } = setup({ LUNA_SESSION_SECRET: 's'.repeat(48) })
  assert.equal(tiktok.status().configured, false)
  assert.throws(() => tiktok.beginAuth(), /not configured/)
})
