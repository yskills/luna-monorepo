// Cockpit data access. Amounts are stored as integer cents (no rounding errors).
const nowIso = () => new Date().toISOString()

const monthKey = (date) => date.toISOString().slice(0, 7)

function previousMonthKey(date) {
  const copy = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
  return monthKey(copy)
}

export function createCockpitStore(db) {
  const statements = {
    listAll: db.prepare(`
      SELECT l.id, l.title, l.created_at AS createdAt,
        (SELECT COUNT(*) FROM list_items i WHERE i.list_id = l.id AND i.done = 0) AS openCount
      FROM lists l ORDER BY l.id ASC`),
    listItems: db.prepare('SELECT id, list_id AS listId, text, done, created_at AS createdAt FROM list_items WHERE list_id = ? ORDER BY done ASC, id ASC'),
    getList: db.prepare('SELECT id, title FROM lists WHERE id = ?'),
    insertList: db.prepare('INSERT INTO lists (title, created_at) VALUES (?, ?)'),
    renameList: db.prepare('UPDATE lists SET title = ? WHERE id = ?'),
    deleteList: db.prepare('DELETE FROM lists WHERE id = ?'),
    insertItem: db.prepare('INSERT INTO list_items (list_id, text, created_at) VALUES (?, ?, ?)'),
    getItem: db.prepare('SELECT id, list_id AS listId, text, done FROM list_items WHERE id = ?'),
    updateItem: db.prepare('UPDATE list_items SET text = ?, done = ? WHERE id = ?'),
    deleteItem: db.prepare('DELETE FROM list_items WHERE id = ?'),
    openItemsTotal: db.prepare('SELECT COUNT(*) AS total FROM list_items WHERE done = 0'),

    moneyRecent: db.prepare(`
      SELECT id, booked_on AS bookedOn, amount_cents AS amountCents, currency, category, note, source
      FROM money_entries ORDER BY booked_on DESC, id DESC LIMIT ?`),
    insertMoney: db.prepare(`
      INSERT INTO money_entries (booked_on, amount_cents, currency, category, note, source, created_at)
      VALUES (@bookedOn, @amountCents, @currency, @category, @note, @source, @createdAt)`),
    deleteMoney: db.prepare('DELETE FROM money_entries WHERE id = ?'),
    moneyByMonth: db.prepare(`
      SELECT currency,
        SUM(CASE WHEN amount_cents > 0 THEN amount_cents ELSE 0 END) AS incomeCents,
        SUM(CASE WHEN amount_cents < 0 THEN -amount_cents ELSE 0 END) AS expenseCents
      FROM money_entries WHERE substr(booked_on, 1, 7) = ? GROUP BY currency`),

    insertMetric: db.prepare('INSERT INTO metrics (source, metric, value, captured_at) VALUES (?, ?, ?, ?)'),
    latestMetrics: db.prepare(`
      SELECT m.source, m.metric, m.value, m.captured_at AS capturedAt
      FROM metrics m
      JOIN (SELECT source, metric, MAX(captured_at) AS latest FROM metrics GROUP BY source, metric) x
        ON x.source = m.source AND x.metric = m.metric AND x.latest = m.captured_at
      ORDER BY m.source, m.metric`),
    metricBefore: db.prepare(`
      SELECT value, captured_at AS capturedAt FROM metrics
      WHERE source = ? AND metric = ? AND captured_at <= ?
      ORDER BY captured_at DESC LIMIT 1`),

    insertBriefing: db.prepare(`
      INSERT INTO briefings (created_at, trigger, facts_json, summary, summary_source)
      VALUES (?, ?, ?, ?, ?)`),
    latestBriefing: db.prepare('SELECT id, created_at AS createdAt, trigger, facts_json AS factsJson, summary, summary_source AS summarySource FROM briefings ORDER BY id DESC LIMIT 1'),
  }

  const toList = (row) => row && ({ ...row, items: statements.listItems.all(row.id).map((item) => ({ ...item, done: !!item.done })) })

  const monthTotals = (key) => statements.moneyByMonth.all(key).map((row) => ({
    currency: row.currency,
    incomeCents: row.incomeCents || 0,
    expenseCents: row.expenseCents || 0,
    netCents: (row.incomeCents || 0) - (row.expenseCents || 0),
  }))

  return {
    lists() {
      return statements.listAll.all().map(toList)
    },
    createList(title) {
      const { lastInsertRowid } = statements.insertList.run(title, nowIso())
      return toList(statements.getList.get(lastInsertRowid))
    },
    renameList(id, title) {
      return statements.renameList.run(title, id).changes > 0
    },
    deleteList(id) {
      return statements.deleteList.run(id).changes > 0
    },
    addItem(listId, text) {
      if (!statements.getList.get(listId)) return null
      const { lastInsertRowid } = statements.insertItem.run(listId, text, nowIso())
      const item = statements.getItem.get(lastInsertRowid)
      return { ...item, done: !!item.done }
    },
    updateItem(id, { text, done }) {
      const current = statements.getItem.get(id)
      if (!current) return null
      const next = {
        text: text ?? current.text,
        done: done == null ? !!current.done : !!done,
      }
      statements.updateItem.run(next.text, next.done ? 1 : 0, id)
      return { ...current, ...next }
    },
    deleteItem(id) {
      return statements.deleteItem.run(id).changes > 0
    },
    openItemsTotal() {
      return statements.openItemsTotal.get().total
    },

    moneyEntries(limit = 100) {
      return statements.moneyRecent.all(limit)
    },
    addMoney(entry) {
      const { lastInsertRowid } = statements.insertMoney.run({ source: 'manual', ...entry, createdAt: nowIso() })
      return { id: Number(lastInsertRowid), ...entry }
    },
    deleteMoney(id) {
      return statements.deleteMoney.run(id).changes > 0
    },
    moneySummary(now = new Date()) {
      return {
        month: monthKey(now),
        current: monthTotals(monthKey(now)),
        previousMonth: previousMonthKey(now),
        previous: monthTotals(previousMonthKey(now)),
      }
    },

    recordMetric(source, metric, value, capturedAt = nowIso()) {
      statements.insertMetric.run(source, metric, value, capturedAt)
    },
    // Latest value per metric plus the change since ~24 hours ago.
    metricsWithChange(now = new Date()) {
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString()
      return statements.latestMetrics.all().map((row) => {
        const before = statements.metricBefore.get(row.source, row.metric, dayAgo)
        return { ...row, change24h: before ? row.value - before.value : null }
      })
    },

    saveBriefing({ trigger, facts, summary, summarySource }) {
      const createdAt = nowIso()
      const { lastInsertRowid } = statements.insertBriefing.run(createdAt, trigger, JSON.stringify(facts), summary, summarySource)
      return { id: Number(lastInsertRowid), createdAt, trigger, facts, summary, summarySource }
    },
    latestBriefing() {
      const row = statements.latestBriefing.get()
      if (!row) return null
      const { factsJson, ...rest } = row
      return { ...rest, facts: JSON.parse(factsJson) }
    },
  }
}
