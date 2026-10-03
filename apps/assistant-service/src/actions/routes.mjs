import express from 'express'
import { z } from 'zod'
import { buildReplyPrompt, draftWithOllama } from './drafting.mjs'

const handle = (fn) => (req, res, next) => Promise.resolve().then(() => fn(req, res)).catch(next)
const idParam = z.coerce.number().int().positive()

function parseId(value) {
  const result = idParam.safeParse(value)
  if (!result.success) throw Object.assign(new Error('Invalid id.'), { status: 400 })
  return result.data
}

const replyDraftSchema = z.object({
  messageId: z.string().trim().min(1).max(512),
  instructions: z.string().trim().max(1000).default(''),
}).strict()

export function createActionRouter({ queue, outlook, env = process.env, draft = draftWithOllama }) {
  const router = express.Router()
  const language = String(env.LUNA_LANGUAGE || 'de').toLowerCase().startsWith('en') ? 'en' : 'de'
  const host = String(env.OLLAMA_HOST || 'http://127.0.0.1:11434')
  const model = String(env.LUNA_DRAFT_MODEL || env.LUNA_BRIEFING_MODEL || env.LLM_MODEL || '').trim()

  router.get('/', handle((req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined
    res.json({ ok: true, actions: queue.list({ status }), pending: queue.pendingCount() })
  }))
  router.post('/', handle((req, res) => res.status(201).json({ ok: true, action: queue.create({ ...req.body, source: 'manual' }) })))
  router.patch('/:id', handle((req, res) => res.json({ ok: true, action: queue.edit(parseId(req.params.id), req.body?.payload) })))
  router.post('/:id/approve', handle(async (req, res) => res.json({ ok: true, action: await queue.approve(parseId(req.params.id)) })))
  router.post('/:id/reject', handle((req, res) => res.json({ ok: true, action: queue.reject(parseId(req.params.id)) })))

  // Luna drafts a reply to one unread mail; it lands in the queue as pending.
  router.post('/drafts/mail-reply', handle(async (req, res) => {
    const parsed = replyDraftSchema.safeParse(req.body)
    if (!parsed.success) throw Object.assign(new Error('messageId is required.'), { status: 400 })
    const summary = await outlook.summary()
    const mail = summary.unread.find((m) => m.id === parsed.data.messageId)
    if (!mail) throw Object.assign(new Error('Mail not found among unread mails.'), { status: 404 })
    if (!mail.fromAddress) throw Object.assign(new Error('This mail has no sender address.'), { status: 409 })

    const body = await draft(buildReplyPrompt({
      mail: { from: `${mail.from} (${mail.fromAddress})`, subject: mail.subject, text: mail.preview },
      instructions: parsed.data.instructions,
      language,
    }), { host, model })

    const subject = /^(re|aw):/i.test(mail.subject) ? mail.subject : `Re: ${mail.subject}`
    const action = queue.create({
      kind: 'mail',
      source: 'luna',
      originLevel: 'standard',
      payload: { to: [mail.fromAddress], subject: subject.slice(0, 200), body, replyToMessageId: mail.id },
    })
    res.status(201).json({ ok: true, action })
  }))

  return router
}
