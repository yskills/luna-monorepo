import crypto from 'node:crypto'

// TikTok (Login Kit for Web + Display API), read-only: profile stats and recent public videos.
// Web Login Kit has no PKCE, so the one-time state is the CSRF protection; tokens are stored encrypted.
const SCOPES = ['user.info.basic', 'user.info.stats', 'video.list']
const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/'
const API = 'https://open.tiktokapis.com/v2'
const PROVIDER = 'tiktok'
const PENDING_TTL_MS = 10 * 60 * 1000
const SUMMARY_TTL_MS = 5 * 60 * 1000

const clip = (value, max = 120) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}
const count = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0)

export function resolveTikTokConfig(env = process.env) {
  const clientKey = String(env.TIKTOK_CLIENT_KEY || '').trim()
  const clientSecret = String(env.TIKTOK_CLIENT_SECRET || '').trim()
  const redirectUri = String(env.TIKTOK_REDIRECT_URI || '').trim()
  return { configured: !!(clientKey && clientSecret && redirectUri), clientKey, clientSecret, redirectUri }
}

export function createTikTokConnector({ env = process.env, secrets, store, fetchImpl = fetch, now = () => new Date(), log = () => {} }) {
  const config = resolveTikTokConfig(env)
  const pending = new Map()
  let cache = null

  const requireConfigured = () => {
    if (!config.configured) throw Object.assign(new Error('TikTok is not configured on the server.'), { status: 409 })
  }

  async function tokenRequest(params) {
    const response = await fetchImpl(`${API}/oauth/token/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, ...params }).toString(),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.access_token) {
      const error = new Error(`Token request failed (${data.error || response.status}).`)
      error.code = data.error
      throw error
    }
    return {
      accessToken: data.access_token,
      // TikTok may rotate the refresh token: always keep the newest one.
      refreshToken: data.refresh_token || params.refresh_token,
      expiresAt: now().getTime() + count(data.expires_in || 86400) * 1000,
      scope: String(data.scope || ''),
    }
  }

  async function api(path, accessToken, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || (data.error?.code && data.error.code !== 'ok')) {
      throw Object.assign(new Error(`TikTok API ${data.error?.code || response.status}`), { status: 502 })
    }
    return data.data || {}
  }

  async function accessToken() {
    const saved = secrets.read(PROVIDER)
    if (!saved?.refreshToken) throw Object.assign(new Error('TikTok is not connected.'), { status: 409 })
    if (saved.accessToken && saved.expiresAt - now().getTime() > 120_000) return saved.accessToken
    try {
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
      secrets.write(PROVIDER, { ...saved, ...fresh })
      return fresh.accessToken
    } catch (error) {
      if (error.code === 'invalid_grant') {
        secrets.delete(PROVIDER)
        cache = null
        log('[tiktok] Refresh token rejected, disconnected.')
      }
      throw Object.assign(error, { status: 502 })
    }
  }

  return {
    id: PROVIDER,

    status() {
      const saved = config.configured ? secrets.read(PROVIDER) : null
      return {
        id: PROVIDER,
        label: 'TikTok',
        configured: config.configured,
        connected: !!saved?.refreshToken,
        account: saved?.account || null,
      }
    },

    beginAuth() {
      requireConfigured()
      const t = now().getTime()
      for (const [key, entry] of pending) if (entry.expiresAt < t) pending.delete(key)
      if (pending.size >= 5) pending.delete(pending.keys().next().value)
      const state = crypto.randomBytes(24).toString('base64url')
      pending.set(state, { expiresAt: t + PENDING_TTL_MS })

      const url = new URL(AUTHORIZE_URL)
      url.search = new URLSearchParams({
        client_key: config.clientKey,
        response_type: 'code',
        scope: SCOPES.join(','),
        redirect_uri: config.redirectUri,
        state,
      }).toString()
      return url.toString()
    },

    async completeAuth({ code, state }) {
      requireConfigured()
      const entry = pending.get(String(state || ''))
      pending.delete(String(state || ''))
      if (!entry || entry.expiresAt < now().getTime()) throw Object.assign(new Error('Login link expired or invalid.'), { status: 400 })
      if (!code) throw Object.assign(new Error('Missing authorization code.'), { status: 400 })

      const tokens = await tokenRequest({ grant_type: 'authorization_code', code: String(code), redirect_uri: config.redirectUri })
      const { user } = await api('/user/info/?fields=display_name', tokens.accessToken)
      secrets.write(PROVIDER, { ...tokens, account: clip(user?.display_name || 'TikTok', 80) })
      cache = null
    },

    async disconnect() {
      const saved = secrets.read(PROVIDER)
      cache = null
      if (saved?.accessToken && config.configured) {
        // Best effort: also revoke the grant at TikTok.
        await fetchImpl(`${API}/oauth/revoke/`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_key: config.clientKey, client_secret: config.clientSecret, token: saved.accessToken }).toString(),
        }).catch(() => {})
      }
      return secrets.delete(PROVIDER)
    },

    // Profile stats and the last 10 public videos. Each fetch is also stored as metrics for trends.
    async summary({ force = false } = {}) {
      if (!force && cache && cache.until > now().getTime()) return cache.value
      const token = await accessToken()
      const [{ user = {} }, { videos = [] }] = await Promise.all([
        api('/user/info/?fields=display_name,follower_count,following_count,likes_count,video_count', token),
        api('/video/list/?fields=id,title,create_time,view_count,like_count,comment_count,share_count', token, { method: 'POST', body: { max_count: 10 } }),
      ])

      const value = {
        followers: count(user.follower_count),
        following: count(user.following_count),
        likes: count(user.likes_count),
        videos: count(user.video_count),
        recent: videos.map((v) => ({
          id: String(v.id || ''),
          title: clip(v.title || '(ohne Titel)'),
          createdAt: v.create_time ? new Date(count(v.create_time) * 1000).toISOString() : null,
          views: count(v.view_count),
          likes: count(v.like_count),
          comments: count(v.comment_count),
          shares: count(v.share_count),
        })),
        fetchedAt: now().toISOString(),
      }
      value.recentViews = value.recent.reduce((sum, v) => sum + v.views, 0)
      if (store) {
        store.recordMetric('tiktok', 'followers', value.followers)
        store.recordMetric('tiktok', 'likes', value.likes)
        store.recordMetric('tiktok', 'videos', value.videos)
        store.recordMetric('tiktok', 'recent_views', value.recentViews)
      }
      cache = { value, until: now().getTime() + SUMMARY_TTL_MS }
      return value
    },
  }
}
