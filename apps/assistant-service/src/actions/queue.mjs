import { z } from 'zod'

// Approval queue for outward actions. Luna (or the owner) creates drafts; only an explicit
// approve call from the logged-in owner sends them, after a final content check at the
// strictest level. Status flow: pending -> sending -> sent | failed | blocked, or pending -> rejected.
const STATUSES = ['pending', 'sending', 'sent', 'failed', 'blocked', 'rejected']

const email = z.string().trim().toLowerCase().email().max(254)

export const PAYLOAD_SCHEMAS = {
  mail: z.object({
    to: z.array(email).min(1).max(10),
    subject: z.string().trim().min(1).max(200),
    body: z.string().trim().min(1).max(20_000),
    // When set, the mail is sent as a reply to this Outlook message.
    replyToMessageId: z.string().trim().min(1).max(512).regex(/^[\w=+/-]+$/).optional(),
  }).strict(),
}

export const createActionSchema = z.object({
  kind: z.enum(Object.keys(PAYLOAD_SCHEMAS)),
  payload: z.record(z.string(), z.unknown()),
  originLevel: z.enum(['public', 'standard', 'adult']).default('standard'),
  source: z.enum(['manual', 'luna']).default('manual'),
}).strict()

const httpError = (status, message) => Object.assign(new Error(message), { status })

function parsePayload(kind, payload) {
  const result = PAYLOAD_SCHEMAS[kind].safeParse(payload)
  if (!result.success) {
    throw httpError(400, result.error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).join('; '))
  }
  return result.data
}

// The text a content check sees: everything a recipient would read.
export const outboundText = (kind, payload) => (kind === 'mail' ? `${payload.subject}\n\n${payload.body}` : '')

// Minimal built-in check until the content policy is wired in: adult-level output never leaves.
export async function defaultOutboundCheck({ originLevel }) {
  if (originLevel === 'adult') return { allowed: false, category: 'adult-origin' }
  return { allowed: true, category: '' }
}

export function createActionQueue({ db, senders = {}, checkOutbound = defaultOutboundCheck, log = () => {} }) {
  const nowIso = () => new Date().toISOString()
  const st = {
    insert: db.prepare(`
      INSERT INTO outbound_actions (kind, status, payload_json, origin_level, source, created_at, updated_at)
      VALUES (@kind, 'pending', @payloadJson, @originLevel, @source, @now, @now)`),
    get: db.prepare('SELECT * FROM outbound_actions WHERE id = ?'),
    list: db.prepare('SELECT * FROM outbound_actions ORDER BY id DESC LIMIT ?'),
    listByStatus: db.prepare('SELECT * FROM outbound_actions WHERE status = ? ORDER BY id DESC LIMIT ?'),
    countPending: db.prepare("SELECT COUNT(*) AS total FROM outbound_actions WHERE status = 'pending'"),
    updatePayload: db.prepare("UPDATE outbound_actions SET payload_json = ?, updated_at = ? WHERE id = ? AND status = 'pending'"),
    // Atomic claim: only one approve can move an action out of pending/failed.
    claim: db.prepare("UPDATE outbound_actions SET status = 'sending', decided_at = ?, updated_at = ?, error = '' WHERE id = ? AND status IN ('pending', 'failed')"),
    finish: db.prepare('UPDATE outbound_actions SET status = ?, error = ?, sent_at = ?, updated_at = ? WHERE id = ?'),
    reject: db.prepare("UPDATE outbound_actions SET status = 'rejected', decided_at = ?, updated_at = ? WHERE id = ? AND status IN ('pending', 'failed', 'blocked')"),
  }

  // A crash mid-send leaves rows in "sending". Surface them as failed so the owner can check
  // Outlook's sent folder before deciding to retry.
  db.prepare(`UPDATE outbound_actions SET status = 'failed', error = ?, updated_at = ? WHERE status = 'sending'`)
    .run('Unknown whether this was sent (the server restarted while sending). Check your sent folder before retrying.', nowIso())

  const toAction = (row) => row && ({
    id: row.id,
    kind: row.kind,
    status: row.status,
    payload: JSON.parse(row.payload_json),
    originLevel: row.origin_level,
    source: row.source,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    decidedAt: row.decided_at,
    sentAt: row.sent_at,
  })

  const mustGet = (id) => {
    const action = toAction(st.get.get(id))
    if (!action) throw httpError(404, 'Not found.')
    return action
  }

  return {
    create(input) {
      const parsed = createActionSchema.safeParse(input)
      if (!parsed.success) throw httpError(400, parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '))
      const { kind, originLevel, source } = parsed.data
      const payload = parsePayload(kind, parsed.data.payload)
      const { lastInsertRowid } = st.insert.run({ kind, payloadJson: JSON.stringify(payload), originLevel, source, now: nowIso() })
      return mustGet(lastInsertRowid)
    },

    list({ status, limit = 100 } = {}) {
      if (status && !STATUSES.includes(status)) throw httpError(400, 'Unknown status.')
      const rows = status ? st.listByStatus.all(status, limit) : st.list.all(limit)
      return rows.map(toAction)
    },

    pendingCount() {
      return st.countPending.get().total
    },

    edit(id, payload) {
      const action = mustGet(id)
      const parsed = parsePayload(action.kind, payload)
      if (st.updatePayload.run(JSON.stringify(parsed), nowIso(), id).changes === 0) {
        throw httpError(409, 'Only pending actions can be edited.')
      }
      return mustGet(id)
    },

    reject(id) {
      mustGet(id)
      if (st.reject.run(nowIso(), nowIso(), id).changes === 0) throw httpError(409, 'This action can no longer be rejected.')
      return mustGet(id)
    },

    async approve(id) {
      const action = mustGet(id)
      const sender = senders[action.kind]
      if (!sender) throw httpError(409, `No sender for "${action.kind}" is available.`)
      if (st.claim.run(nowIso(), nowIso(), id).changes === 0) throw httpError(409, `Action is already ${action.status}.`)

      let verdict
      try {
        verdict = await checkOutbound({ text: outboundText(action.kind, action.payload), originLevel: action.originLevel, kind: action.kind })
      } catch (error) {
        // A failing check must never let content through.
        verdict = { allowed: false, category: 'check-unavailable' }
        log(`[actions] Outbound check failed: ${error.message}`)
      }
      if (!verdict?.allowed) {
        st.finish.run('blocked', `Blocked by content check (${verdict?.category || 'unknown'}).`, null, nowIso(), id)
        return mustGet(id)
      }

      try {
        await sender(action.payload)
        st.finish.run('sent', '', nowIso(), nowIso(), id)
      } catch (error) {
        log(`[actions] Send failed for #${id}: ${error.message}`)
        st.finish.run('failed', String(error.message || 'Send failed.').slice(0, 300), null, nowIso(), id)
      }
      return mustGet(id)
    },
  }
}
