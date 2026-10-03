<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '../stores/authStore'

const auth = useAuthStore()
const router = useRouter()
const route = useRoute()
const password = ref('')

const safeRedirect = (value) => {
  const target = String(value || '')
  return target.startsWith('/') && !target.startsWith('//') ? target : '/'
}

async function submit() {
  if (!password.value || auth.busy) return
  const ok = await auth.login(password.value)
  password.value = ''
  if (ok) {
    router.replace(safeRedirect(route.query.redirect))
  }
}
</script>

<template>
  <section class="login surface panel">
    <h2>Luna</h2>
    <p class="muted">Privat. Bitte Admin-Passwort eingeben.</p>
    <form @submit.prevent="submit">
      <input
        v-model="password"
        type="password"
        name="password"
        autocomplete="current-password"
        placeholder="Passwort"
        :disabled="auth.busy"
        autofocus
      />
      <button type="submit" :disabled="auth.busy || !password">Einloggen</button>
    </form>
    <p v-if="auth.error" class="login-error">{{ auth.error }}</p>
  </section>
</template>

<style scoped>
.login {
  max-width: 360px;
  margin: 12vh auto 0;
  display: grid;
  gap: 12px;
}

.login h2 {
  margin: 0;
}

.login form {
  display: grid;
  gap: 10px;
}

.login input {
  padding: 12px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.15);
  background: rgba(255, 255, 255, 0.06);
  color: inherit;
  font-size: 1rem;
}

.login button {
  padding: 12px;
  border: 0;
  border-radius: 10px;
  background: #2e5cff;
  color: #fff;
  font-weight: 600;
  cursor: pointer;
}

.login button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.login-error {
  margin: 0;
  color: #ff6b6b;
}
</style>
