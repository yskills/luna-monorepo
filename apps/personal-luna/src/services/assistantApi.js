import { createAssistantSdkClient } from '@luna/assistant-sdk'
import { API_BASE_URL } from '../config/api'

export class AssistantApiClient {
  constructor({ baseUrl = API_BASE_URL } = {}) {
    this.client = createAssistantSdkClient({
      baseUrl,
      apiKey: import.meta.env.VITE_ASSISTANT_API_KEY,
    })
  }

  async chat({ message, mode, characterId }) {
    return this.client.chat({ message, mode, characterId })
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

  async getTrainingStatus(minCurated = 20) {
    return this.client.getTrainingStatus(minCurated)
  }

  async getTrainerHealth() {
    return this.client.getTrainerHealth()
  }
}

export const assistantApi = new AssistantApiClient()
