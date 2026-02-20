import { lunaPresetRegistry } from '../config/lunaPreset'
import { assistantApi } from './assistantApi'

export class ChatOrchestrator {
  constructor({ apiClient = assistantApi, presetRegistry = lunaPresetRegistry } = {}) {
    this.apiClient = apiClient
    this.presetRegistry = presetRegistry
  }

  // Zentrale Initialwerte für alle UI-Stores, damit die Defaults nur an einer Stelle gepflegt werden.
  createInitialState() {
    return {
      characterId: this.presetRegistry.getCharacterId(),
      mode: this.presetRegistry.getDefaultMode(),
      uncensoredRequiresPassword: false,
      messages: [
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          text: 'Hi ✨ Ich bin Luna. Sag mir, was wir heute bauen oder organisieren.',
        },
      ],
      loading: false,
      lastError: '',
    }
  }

  async loadMode(characterId, fallbackMode = 'normal') {
    const modeState = await this.apiClient.getMode(characterId)
    return {
      mode: String(modeState?.mode || fallbackMode).trim().toLowerCase() || fallbackMode,
      uncensoredRequiresPassword: modeState?.uncensoredRequiresPassword === true,
    }
  }

  async applyModePreset(mode, characterId) {
    const presetId = this.presetRegistry.resolvePresetId(mode)
    if (!presetId) return

    await this.apiClient.applyPreset({
      presetId,
      mode,
      characterId,
    })
  }

  async switchMode(mode, characterId, password = '') {
    await this.apiClient.setMode({
      mode,
      characterId,
      password,
    })

    await this.applyModePreset(mode, characterId)
  }

  // Einfache Delegation: UI bleibt schlank, API-Details bleiben im Service.
  async sendChatMessage({ message, mode, characterId }) {
    return this.apiClient.chat({ message, mode, characterId })
  }
}

export const chatOrchestrator = new ChatOrchestrator()
