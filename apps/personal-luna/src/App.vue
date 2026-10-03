<script setup>
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/authStore'

const auth = useAuthStore()
const router = useRouter()

async function logout() {
  await auth.logout()
  router.replace({ name: 'login' })
}
</script>

<template>
  <div class="app-shell">
    <header v-if="auth.authenticated" class="topbar">
      <div>
        <p class="eyebrow">Personal Luna</p>
        <h1>Deine persönliche KI-Begleiterin</h1>
      </div>
      <nav class="mode-switch">
        <RouterLink to="/" class="mode-link" active-class="active">Full</RouterLink>
        <RouterLink to="/chat" class="mode-link" active-class="active">Chat only</RouterLink>
        <button type="button" class="mode-link" @click="logout">Logout</button>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
