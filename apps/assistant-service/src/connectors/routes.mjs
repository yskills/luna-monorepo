import express from 'express'

const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)

// Public OAuth callbacks: the session cookie (SameSite=Strict) is not sent on the redirect back
// from the provider, so the one-time state created by the logged-in /start request authorizes it.
export function createOAuthCallbackRouter({ connectors, log = () => {} }) {
  const router = express.Router()
  for (const connector of connectors) {
    router.get(`/${connector.id}/callback`, async (req, res) => {
      if (req.query.error) {
        log(`[${connector.id}] Authorization declined: ${String(req.query.error).slice(0, 60)}`)
        return res.redirect(303, `/?connect=${connector.id}-declined`)
      }
      try {
        await connector.completeAuth({ code: req.query.code, state: req.query.state })
        res.redirect(303, `/?connect=${connector.id}-ok`)
      } catch (error) {
        log(`[${connector.id}] Connect failed: ${error.message}`)
        res.redirect(303, `/?connect=${connector.id}-failed`)
      }
    })
  }
  return router
}

export function createConnectorRouter({ connectors }) {
  const router = express.Router()
  router.get('/', (_req, res) => res.json({ ok: true, connectors: connectors.map((c) => c.status()) }))
  for (const connector of connectors) {
    router.get(`/${connector.id}/start`, handle((_req, res) => res.redirect(303, connector.beginAuth())))
    router.get(`/${connector.id}/summary`, handle(async (req, res) => {
      res.json({ ok: true, [connector.id]: await connector.summary({ force: req.query.refresh === '1' }) })
    }))
    router.post(`/${connector.id}/disconnect`, handle(async (_req, res) => res.json({ ok: true, removed: await connector.disconnect() })))
  }
  return router
}

// Refreshes every connected source so metrics build up a history (24h trends) even when nobody looks.
export async function syncConnectors(connectors, log = () => {}) {
  for (const connector of connectors) {
    if (!connector.status().connected) continue
    try {
      await connector.summary({ force: true })
    } catch (error) {
      log(`[${connector.id}] Sync failed: ${error.message}`)
    }
  }
}
