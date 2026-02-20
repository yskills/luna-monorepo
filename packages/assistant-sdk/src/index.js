export class AssistantSdkClient {
  constructor({ baseUrl = '/assistant', apiKey = '' } = {}) {
    this.baseUrl = String(baseUrl || '/assistant').replace(/\/$/, '')
    this.apiKey = String(apiKey || '').trim()
  }

  buildHeaders() {
    const headers = { 'Content-Type': 'application/json' }
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`
    }
    return headers
  }

  async request(path, method = 'GET', body = null) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: this.buildHeaders(),
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json().catch(() => ({}))
    if (!response.ok || data?.ok === false) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`)
    }

    return data
  }

  health() {
    const healthBase = this.baseUrl.replace(/\/assistant$/, '')
    return fetch(`${healthBase}/health`, {
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

  getTrainingStatus(minCurated = 20) {
    return this.request(`/training/status?minCurated=${encodeURIComponent(minCurated)}`)
  }

  getTrainerHealth() {
    return this.request('/training/lora/provider-health')
  }
}

export function createAssistantSdkClient(options = {}) {
  return new AssistantSdkClient(options)
}
