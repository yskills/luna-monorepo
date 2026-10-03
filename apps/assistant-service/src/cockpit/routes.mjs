import express from 'express'
import { z } from 'zod'

const idParam = z.coerce.number().int().positive()
const text = (max) => z.string().trim().min(1).max(max)

const schemas = {
  list: z.object({ title: text(120) }).strict(),
  item: z.object({ text: text(500) }).strict(),
  itemUpdate: z.object({ text: text(500).optional(), done: z.boolean().optional() }).strict(),
  money: z.object({
    bookedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    amountCents: z.number().int().refine((v) => v !== 0 && Math.abs(v) <= 1_000_000_000, 'invalid amount'),
    currency: z.string().regex(/^[A-Z]{3}$/).default('EUR'),
    category: z.string().trim().max(60).default(''),
    note: z.string().trim().max(300).default(''),
  }).strict(),
}

function validate(schema, value) {
  const result = schema.safeParse(value)
  if (!result.success) {
    const error = new Error(result.error.issues.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`).join('; '))
    error.status = 400
    throw error
  }
  return result.data
}

const notFound = () => Object.assign(new Error('Not found.'), { status: 404 })

// Express 4 does not catch promise rejections: forward them to the central error handler.
const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)

export function createCockpitRouter({ store, briefing, connectors = () => [] }) {
  const router = express.Router()

  router.get('/dashboard', handle((_req, res) => {
    res.json({
      ok: true,
      money: store.moneySummary(),
      openTodos: store.openItemsTotal(),
      metrics: store.metricsWithChange(),
      briefing: store.latestBriefing(),
      connectors: connectors(),
    })
  }))

  router.get('/lists', handle((_req, res) => res.json({ ok: true, lists: store.lists() })))
  router.post('/lists', handle((req, res) => {
    const { title } = validate(schemas.list, req.body)
    res.status(201).json({ ok: true, list: store.createList(title) })
  }))
  router.patch('/lists/:id', handle((req, res) => {
    const { title } = validate(schemas.list, req.body)
    if (!store.renameList(validate(idParam, req.params.id), title)) throw notFound()
    res.json({ ok: true })
  }))
  router.delete('/lists/:id', handle((req, res) => {
    if (!store.deleteList(validate(idParam, req.params.id))) throw notFound()
    res.json({ ok: true })
  }))
  router.post('/lists/:id/items', handle((req, res) => {
    const { text: itemText } = validate(schemas.item, req.body)
    const item = store.addItem(validate(idParam, req.params.id), itemText)
    if (!item) throw notFound()
    res.status(201).json({ ok: true, item })
  }))
  router.patch('/items/:id', handle((req, res) => {
    const item = store.updateItem(validate(idParam, req.params.id), validate(schemas.itemUpdate, req.body))
    if (!item) throw notFound()
    res.json({ ok: true, item })
  }))
  router.delete('/items/:id', handle((req, res) => {
    if (!store.deleteItem(validate(idParam, req.params.id))) throw notFound()
    res.json({ ok: true })
  }))

  router.get('/money', handle((_req, res) => {
    res.json({ ok: true, entries: store.moneyEntries(200), summary: store.moneySummary() })
  }))
  router.post('/money', handle((req, res) => {
    res.status(201).json({ ok: true, entry: store.addMoney(validate(schemas.money, req.body)) })
  }))
  router.delete('/money/:id', handle((req, res) => {
    if (!store.deleteMoney(validate(idParam, req.params.id))) throw notFound()
    res.json({ ok: true })
  }))

  router.get('/briefing', handle((_req, res) => res.json({ ok: true, briefing: store.latestBriefing() })))
  router.post('/briefing/run', handle(async (_req, res) => {
    res.json({ ok: true, briefing: await briefing.run('manual') })
  }))

  return router
}
