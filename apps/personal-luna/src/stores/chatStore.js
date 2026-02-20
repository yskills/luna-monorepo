import { defineStore } from 'pinia'
import { chatOrchestrator } from '../services/ChatOrchestrator'

export const useChatStore = defineStore('chat', {
  state: () => chatOrchestrator.createInitialState(),
  actions: {
    async initialize() {
      try {
        const modeState = await chatOrchestrator.loadMode(this.characterId, this.mode)
        this.mode = modeState.mode
        this.uncensoredRequiresPassword = modeState.uncensoredRequiresPassword === true
      } catch {
        // keep local defaults
      }
    },

    async applyCurrentModePreset() {
      await chatOrchestrator.applyModePreset(this.mode, this.characterId)
    },

    async setMode(nextMode) {
      this.lastError = ''
      this.mode = nextMode
      try {
        let password = ''
        if (nextMode === 'uncensored' && this.uncensoredRequiresPassword === true) {
          password = window.prompt('Passwort für Uncensored Mode', '') || ''
        }

        await chatOrchestrator.switchMode(nextMode, this.characterId, password)
      } catch (error) {
        this.lastError = error.message
      }
    },

    async sendMessage(text) {
      const message = String(text || '').trim()
      if (!message || this.loading) return

      this.lastError = ''
      this.messages.push({ id: crypto.randomUUID(), role: 'user', text: message })
      this.loading = true

      try {
        const result = await chatOrchestrator.sendChatMessage({
          message,
          mode: this.mode,
          characterId: this.characterId,
        })

        this.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: String(result?.reply || '').trim() || '(leere Antwort)',
        })
      } catch (error) {
        this.lastError = error.message
        this.messages.push({
          id: crypto.randomUUID(),
          role: 'assistant',
          text: `Fehler: ${error.message}`,
        })
      } finally {
        this.loading = false
      }
    },
  },
})
