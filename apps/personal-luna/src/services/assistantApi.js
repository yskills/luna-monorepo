import { createAssistantSdkClient } from '@luna/assistant-sdk'
import { API_BASE_URL } from '../config/api'

export const UNAUTHORIZED_EVENT = 'luna:unauthorized'

// Kein API-Key im Frontend: alles mit VITE_ landet öffentlich im Bundle.
// Die App authentifiziert sich per HttpOnly-Session-Cookie.
export class AssistantApiClient {
  constructor({ baseUrl = API_BASE_URL } = {}) {
    this.client = createAssistantSdkClient({
      baseUrl,
      onUnauthorized: () => window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)),
    })
  }

  async login(password) {
    return this.client.login(password)
  }

  async logout() {
    return this.client.logout()
  }

  async me() {
    return this.client.me()
  }

  async chat({ message, mode, characterId }) {
    return this.client.chat({ message, mode, characterId })
  }

  async generateImage({ prompt, mode, characterId }) {
    return this.client.generateImage({ prompt, mode, characterId })
  }

  async setMode({ mode, characterId, password = '' }) {
    return this.client.setMode({ mode, characterId, password })
  }

  async applyPreset({ presetId, mode, characterId }) {
    return this.client.applyLunaPreset({ presetId, mode, characterId })
  }

  async getMode(characterId) {
    return this.client.getMode(characterId)
  }

  async getVoice(characterId) {
    return this.client.getVoiceSettings(characterId)
  }

  async getHealth() {
    return this.client.health()
  }

  async getTrainingStatus(minCurated = 300) {
    return this.client.getTrainingStatus(minCurated)
  }

  async getTrainerHealth() {
    return this.client.getTrainerHealth()
  }
}

export const assistantApi = new AssistantApiClient()
