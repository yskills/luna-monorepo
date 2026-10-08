export class AssistantSdkError extends Error {
  constructor(message, status) {
    super(message)
    this.name = 'AssistantSdkError'
    this.status = status
  }
}

// Im Browser authentifiziert das Session-Cookie (same-origin).
// `apiKey` ist nur für Server-zu-Server-Jobs gedacht und gehört nie in ein Frontend-Bundle.
export class AssistantSdkClient {
  constructor({ baseUrl = '/assistant', apiKey = '', onUnauthorized = null } = {}) {
    this.baseUrl = String(baseUrl || '/assistant').replace(/\/$/, '')
    this.rootUrl = this.baseUrl.replace(/\/assistant$/, '')
    this.apiKey = String(apiKey || '').trim()
    this.onUnauthorized = typeof onUnauthorized === 'function' ? onUnauthorized : null
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async request(path, method = 'GET', body = null, { base = this.baseUrl } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: this.buildHeaders(),
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json().catch(() => ({}))
    if (response.status === 401 && this.onUnauthorized && !path.startsWith('/me')) {
      this.onUnauthorized()
    }
    if (!response.ok || data?.ok === false) {
      throw new AssistantSdkError(data?.error?.message || `HTTP ${response.status}`, response.status)
    }

    return data
  }

  login(password) {
    return this.request('/login', 'POST', { password }, { base: `${this.rootUrl}/auth` })
  }

  logout() {
    return this.request('/logout', 'POST', null, { base: `${this.rootUrl}/auth` })
  }

  async me() {
    try {
      return await this.request('/me', 'GET', null, { base: `${this.rootUrl}/auth` })
    } catch (error) {
      if (error?.status === 401) return { ok: false, authenticated: false }
      throw error
    }
  }

  health() {
    return fetch(`${this.rootUrl}/health`, {
      method: 'GET',
      headers: this.buildHeaders(),
    }).then(async (response) => {
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data?.error?.message || `HTTP ${response.status}`)
      }
      return data
    })
  }

  chat({ message, mode, characterId }) {
    return this.request('/chat', 'POST', { message, mode, characterId })
  }

  // Returns { type: 'image', image: { url, ... } } or, when blocked, { type: 'text', reply }.
  generateImage({ prompt, mode, characterId }) {
    return this.request('/image', 'POST', { prompt, mode, characterId })
  }

  getSafetyBlocks(limit = 50) {
    return this.request(`/safety/blocks?limit=${encodeURIComponent(limit)}`)
  }

  getMode(characterId = 'luna') {
    return this.request(`/mode?characterId=${encodeURIComponent(characterId)}`)
  }

  setMode({ mode, characterId = 'luna', password = '' }) {
    return this.request('/mode', 'POST', { mode, characterId, password })
  }

  getLunaPresets() {
    return this.request('/luna/presets', 'GET')
  }

  applyLunaPreset({ presetId, mode, characterId = 'luna' }) {
    return this.request('/luna/presets/apply', 'POST', { presetId, mode, characterId })
  }

  getVoiceSettings(characterId = 'luna') {
    return this.request(`/voice/settings?characterId=${encodeURIComponent(characterId)}`)
  }

  getTrainingStatus(minCurated = 300) {
    return this.request(`/training/status?minCurated=${encodeURIComponent(minCurated)}`)
  }

  getTrainerHealth() {
    return this.request('/training/lora/provider-health')
  }
}

export function createAssistantSdkClient(options = {}) {
  return new AssistantSdkClient(options)
}
