import { defineStore } from 'pinia'
import { assistantApi } from '../services/assistantApi'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    authenticated: false,
    checked: false,
    error: '',
    busy: false,
  }),
  actions: {
    async check() {
      try {
        const result = await assistantApi.me()
        this.authenticated = result?.authenticated === true
      } catch {
        this.authenticated = false
      }
      this.checked = true
      return this.authenticated
    },

    async login(password) {
      this.busy = true
      this.error = ''
      try {
        await assistantApi.login(password)
        this.authenticated = true
        this.checked = true
        return true
      } catch (error) {
        this.error = error?.status === 429
          ? 'Zu viele Fehlversuche. Bitte später erneut versuchen.'
          : 'Falsches Passwort.'
        return false
      } finally {
        this.busy = false
      }
    },

    async logout() {
      try {
        await assistantApi.logout()
      } finally {
        this.authenticated = false
      }
    },

    markLoggedOut() {
      this.authenticated = false
      this.checked = true
    },
  },
})
