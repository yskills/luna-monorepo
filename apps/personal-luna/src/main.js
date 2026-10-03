import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import { UNAUTHORIZED_EVENT } from './services/assistantApi'
import { useAuthStore } from './stores/authStore'
import './style.css'

const app = createApp(App)
app.use(createPinia())
app.use(router)

// Session abgelaufen oder Passwort geändert: zurück zum Login.
window.addEventListener(UNAUTHORIZED_EVENT, () => {
  useAuthStore().markLoggedOut()
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login' })
  }
})

app.mount('#app')
