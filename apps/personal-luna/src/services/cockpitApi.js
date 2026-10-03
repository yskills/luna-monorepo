import { UNAUTHORIZED_EVENT } from './assistantApi'

// Same-origin JSON client for the cockpit API (/api). Auth is the HttpOnly session cookie.
async function request(path, { method = 'GET', body } = {}) {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  })
  if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data.ok === false) {
    const error = new Error(data?.error?.message || `HTTP ${response.status}`)
    error.status = response.status
    throw error
  }
  return data
}

export const cockpitApi = {
  dashboard: () => request('/dashboard'),
  lists: () => request('/lists'),
  createList: (title) => request('/lists', { method: 'POST', body: { title } }),
  renameList: (id, title) => request(`/lists/${id}`, { method: 'PATCH', body: { title } }),
  deleteList: (id) => request(`/lists/${id}`, { method: 'DELETE' }),
  addItem: (listId, text) => request(`/lists/${listId}/items`, { method: 'POST', body: { text } }),
  updateItem: (id, patch) => request(`/items/${id}`, { method: 'PATCH', body: patch }),
  deleteItem: (id) => request(`/items/${id}`, { method: 'DELETE' }),
  money: () => request('/money'),
  addMoney: (entry) => request('/money', { method: 'POST', body: entry }),
  deleteMoney: (id) => request(`/money/${id}`, { method: 'DELETE' }),
  runBriefing: () => request('/briefing/run', { method: 'POST' }),
  outlookSummary: (refresh = false) => request(`/connectors/outlook/summary${refresh ? '?refresh=1' : ''}`),
  disconnectOutlook: () => request('/connectors/outlook/disconnect', { method: 'POST' }),
  // OAuth needs a full-page navigation to Microsoft, not a fetch.
  connectOutlook: () => window.location.assign('/api/connectors/outlook/start'),
}

export const formatCents = (cents, currency = 'EUR') =>
  new Intl.NumberFormat('de-DE', { style: 'currency', currency }).format(cents / 100)

// Accepts "12,50", "-3.99" or "1.234,56" and returns integer cents (or null).
export function parseAmountToCents(input) {
  const raw = String(input || '').trim().replace(/\s/g, '')
  if (!/^-?[\d.,]+$/.test(raw)) return null
  const lastSep = Math.max(raw.lastIndexOf(','), raw.lastIndexOf('.'))
  const hasDecimals = lastSep >= 0 && raw.length - lastSep - 1 <= 2
  const intPart = (hasDecimals ? raw.slice(0, lastSep) : raw).replace(/[.,]/g, '')
  const decPart = hasDecimals ? raw.slice(lastSep + 1).padEnd(2, '0') : '00'
  const negative = intPart.startsWith('-')
  const cents = Number(intPart.replace('-', '') || '0') * 100 + Number(decPart)
  if (!Number.isSafeInteger(cents) || cents === 0) return null
  return negative ? -cents : cents
}
