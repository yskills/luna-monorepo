import express from 'express'

const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)

// Public OAuth callback: the session cookie (SameSite=Strict) is not sent on the redirect back
// from Microsoft, so the one-time state created by the logged-in /start request authorizes it.
export function createOAuthCallbackRouter({ outlook, log = () => {} }) {
  const router = express.Router()
  router.get('/outlook/callback', async (req, res) => {
    if (req.query.error) {
      log(`[outlook] Authorization declined: ${String(req.query.error).slice(0, 60)}`)
      return res.redirect(303, '/?connect=outlook-declined')
    }
    try {
      await outlook.completeAuth({ code: req.query.code, state: req.query.state })
      res.redirect(303, '/?connect=outlook-ok')
    } catch (error) {
      log(`[outlook] Connect failed: ${error.message}`)
      res.redirect(303, '/?connect=outlook-failed')
    }
  })
  return router
}

export function createConnectorRouter({ outlook }) {
  const router = express.Router()
  router.get('/', (_req, res) => res.json({ ok: true, connectors: [outlook.status()] }))
  router.get('/outlook/start', handle((_req, res) => res.redirect(303, outlook.beginAuth())))
  router.get('/outlook/summary', handle(async (req, res) => {
    res.json({ ok: true, outlook: await outlook.summary({ force: req.query.refresh === '1' }) })
  }))
  router.post('/outlook/disconnect', handle((_req, res) => res.json({ ok: true, removed: outlook.disconnect() })))
  return router
}
