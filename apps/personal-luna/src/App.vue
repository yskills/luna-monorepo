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
        <RouterLink to="/" class="mode-link" exact-active-class="active">Cockpit</RouterLink>
        <RouterLink to="/luna" class="mode-link" active-class="active">Luna</RouterLink>
        <RouterLink to="/lists" class="mode-link" active-class="active">Listen</RouterLink>
        <RouterLink to="/money" class="mode-link" active-class="active">Geld</RouterLink>
        <RouterLink to="/actions" class="mode-link" active-class="active">Freigaben</RouterLink>
        <button type="button" class="mode-link" @click="logout">Logout</button>
      </nav>
    </header>
    <main>
      <RouterView />
    </main>
  </div>
</template>
