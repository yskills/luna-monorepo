<script setup>
import { onMounted } from 'vue'
import ChatWindow from '../components/ChatWindow.vue'
import { useChatStore } from '../stores/chatStore'

const store = useChatStore()

onMounted(async () => {
  await store.initialize()
})
</script>

<template>
  <section class="grid">
    <header class="surface panel">
      <h2>Chat only</h2>
      <p class="muted">Fokussierte Ansicht nur für Unterhaltung mit Luna.</p>
    </header>
    <ChatWindow />
  </section>
</template>
