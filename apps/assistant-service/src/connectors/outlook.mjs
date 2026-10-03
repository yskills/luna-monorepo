import crypto from 'node:crypto'

// Outlook (Microsoft Graph): unread mail and today's calendar, and sending mails that the
// owner approved in the action queue (src/actions/queue.mjs is the only caller of sendMail).
// OAuth 2.0 authorization code flow with PKCE; tokens are stored encrypted (see secretBox.mjs).
const SCOPES = ['offline_access', 'User.Read', 'Mail.Read', 'Mail.Send', 'Calendars.Read']
const GRAPH = 'https://graph.microsoft.com/v1.0'
const PROVIDER = 'outlook'
const PENDING_TTL_MS = 10 * 60 * 1000
const SUMMARY_TTL_MS = 60 * 1000

const clip = (value, max = 160) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

// Midnight of the current day in the given IANA timezone (the server itself usually runs in UTC).
export function startOfDayInZone(date, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date).map((p) => [p.type, Number(p.value)]))
  const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second)
  const offsetMs = Math.round((wallAsUtc - date.getTime()) / 60_000) * 60_000
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day) - offsetMs)
}

export function resolveOutlookConfig(env = process.env) {
  const clientId = String(env.OUTLOOK_CLIENT_ID || '').trim()
  const clientSecret = String(env.OUTLOOK_CLIENT_SECRET || '').trim()
  const redirectUri = String(env.OUTLOOK_REDIRECT_URI || '').trim()
  const tenant = String(env.OUTLOOK_TENANT || 'consumers').trim()
  if (!/^[\w.-]+$/.test(tenant)) throw new Error('OUTLOOK_TENANT has an invalid value.')
  return {
    configured: !!(clientId && clientSecret && redirectUri),
    clientId,
    clientSecret,
    redirectUri,
    authority: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`,
    timezone: String(env.LUNA_TIMEZONE || 'Europe/Berlin'),
  }
}

export function createOutlookConnector({ env = process.env, secrets, store, fetchImpl = fetch, now = () => new Date(), log = () => {} }) {
  const config = resolveOutlookConfig(env)
  const pending = new Map()
  let cache = null

  const requireConfigured = () => {
    if (!config.configured) throw Object.assign(new Error('Outlook is not configured on the server.'), { status: 409 })
  }

  async function tokenRequest(params) {
    const response = await fetchImpl(`${config.authority}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: config.clientId,
        client_secret: config.clientSecret,
        scope: SCOPES.join(' '),
        ...params,
      }).toString(),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.access_token) {
      const error = new Error(`Token request failed (${data.error || response.status}).`)
      error.code = data.error
      throw error
    }
    return {
      accessToken: data.access_token,
      // Microsoft rotates refresh tokens: always keep the newest one.
      refreshToken: data.refresh_token || params.refresh_token,
      expiresAt: now().getTime() + Number(data.expires_in || 3600) * 1000,
      // Keep the granted scopes from the first grant if a refresh does not repeat them.
      ...(data.scope ? { scope: String(data.scope) } : {}),
    }
  }

  async function graph(path, accessToken, headers = {}, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${GRAPH}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    if (!response.ok) {
      const error = new Error(`Microsoft Graph HTTP ${response.status}`)
      error.status = 502
      throw error
    }
    // sendMail and reply answer 202 without a body.
    return response.status === 202 || response.status === 204 ? {} : response.json()
  }

  // Scopes may come back short ("Mail.Send") or fully qualified ("https://graph.microsoft.com/Mail.Send").
  const canSend = (saved) => String(saved?.scope || '').split(/\s+/).some((s) => /(^|\/)Mail\.Send$/i.test(s))

  // Graph renders a reply "comment" as HTML: escape it so the recipient sees exactly the approved text.
  const textToHtml = (text) => String(text)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
    .replace(/\r?\n/g, '<br>')

  async function accessToken() {
    const saved = secrets.read(PROVIDER)
    if (!saved?.refreshToken) throw Object.assign(new Error('Outlook is not connected.'), { status: 409 })
    if (saved.accessToken && saved.expiresAt - now().getTime() > 120_000) return saved.accessToken
    try {
      const fresh = await tokenRequest({ grant_type: 'refresh_token', refresh_token: saved.refreshToken })
      secrets.write(PROVIDER, { ...saved, ...fresh })
      return fresh.accessToken
    } catch (error) {
      if (error.code === 'invalid_grant') {
        // Consent revoked or refresh token expired: the user has to connect again.
        secrets.delete(PROVIDER)
        cache = null
        log('[outlook] Refresh token rejected, disconnected.')
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
        label: 'Outlook',
        configured: config.configured,
        connected: !!saved?.refreshToken,
        account: saved?.account || null,
        // Connections made before sending existed lack Mail.Send: reconnect once to enable it.
        canSend: canSend(saved),
      }
    },

    // Only called by the action queue after the owner approved the mail.
    async sendMail({ to, subject, body, replyToMessageId }) {
      const saved = secrets.read(PROVIDER)
      if (!canSend(saved)) throw Object.assign(new Error('Outlook needs to be reconnected to allow sending.'), { status: 409 })
      const token = await accessToken()
      const recipients = to.map((address) => ({ emailAddress: { address } }))
      if (replyToMessageId) {
        await graph(`/me/messages/${encodeURIComponent(replyToMessageId)}/reply`, token, {}, {
          method: 'POST',
          body: { message: { toRecipients: recipients }, comment: textToHtml(body) },
        })
      } else {
        await graph('/me/sendMail', token, {}, {
          method: 'POST',
          body: { message: { subject, body: { contentType: 'Text', content: body }, toRecipients: recipients }, saveToSentItems: true },
        })
      }
      cache = null
    },

    beginAuth() {
      requireConfigured()
      const t = now().getTime()
      for (const [key, entry] of pending) if (entry.expiresAt < t) pending.delete(key)
      if (pending.size >= 5) pending.delete(pending.keys().next().value)

      const state = crypto.randomBytes(24).toString('base64url')
      const verifier = crypto.randomBytes(48).toString('base64url')
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url')
      pending.set(state, { verifier, expiresAt: t + PENDING_TTL_MS })

      const url = new URL(`${config.authority}/authorize`)
      url.search = new URLSearchParams({
        client_id: config.clientId,
        response_type: 'code',
        redirect_uri: config.redirectUri,
        response_mode: 'query',
        scope: SCOPES.join(' '),
        state,
        code_challenge: challenge,
        code_challenge_method: 'S256',
        prompt: 'select_account',
      }).toString()
      return url.toString()
    },

    async completeAuth({ code, state }) {
      requireConfigured()
      const entry = pending.get(String(state || ''))
      pending.delete(String(state || ''))
      if (!entry || entry.expiresAt < now().getTime()) throw Object.assign(new Error('Login link expired or invalid.'), { status: 400 })
      if (!code) throw Object.assign(new Error('Missing authorization code.'), { status: 400 })

      const tokens = await tokenRequest({
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: config.redirectUri,
        code_verifier: entry.verifier,
      })
      const me = await graph('/me?$select=mail,userPrincipalName', tokens.accessToken)
      secrets.write(PROVIDER, { ...tokens, account: clip(me.mail || me.userPrincipalName || '', 120) })
      cache = null
    },

    disconnect() {
      cache = null
      return secrets.delete(PROVIDER)
    },

    // Unread mail and today's events. Cached briefly so dashboard reloads do not hammer Graph.
    async summary({ force = false } = {}) {
      if (!force && cache && cache.until > now().getTime()) return cache.value
      const token = await accessToken()
      const start = now()
      const dayStart = startOfDayInZone(start, config.timezone)
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000)
      const tzHeader = { Prefer: `outlook.timezone="${config.timezone}"` }

      const [inbox, unread, events] = await Promise.all([
        graph('/me/mailFolders/inbox?$select=unreadItemCount', token),
        graph('/me/mailFolders/inbox/messages?$filter=isRead%20eq%20false&$top=5&$select=id,subject,from,receivedDateTime,importance,bodyPreview', token),
        graph(`/me/calendarView?startDateTime=${encodeURIComponent(dayStart.toISOString())}&endDateTime=${encodeURIComponent(dayEnd.toISOString())}&$select=subject,start,end,location,isAllDay&$orderby=start/dateTime&$top=10`, token, tzHeader),
      ])

      const value = {
        unreadCount: Number(inbox.unreadItemCount || 0),
        unread: (unread.value || []).map((m) => ({
          id: String(m.id || ''),
          fromAddress: String(m.from?.emailAddress?.address || '').slice(0, 254),
          subject: clip(m.subject || '(ohne Betreff)'),
          from: clip(m.from?.emailAddress?.name || m.from?.emailAddress?.address || '', 80),
          receivedAt: m.receivedDateTime,
          important: m.importance === 'high',
          preview: clip(m.bodyPreview || '', 400),
        })),
        events: (events.value || []).map((e) => ({
          subject: clip(e.subject || '(ohne Titel)'),
          start: e.start?.dateTime,
          end: e.end?.dateTime,
          allDay: !!e.isAllDay,
          location: clip(e.location?.displayName || '', 80),
        })),
        fetchedAt: start.toISOString(),
      }
      store?.recordMetric('outlook', 'unread', value.unreadCount)
      cache = { value, until: now().getTime() + SUMMARY_TTL_MS }
      return value
    },
  }
}
