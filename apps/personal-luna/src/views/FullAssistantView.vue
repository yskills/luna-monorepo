<script setup>
import { onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import ChatWindow from '../components/ChatWindow.vue'
import { lunaPresetRegistry } from '../config/lunaPreset'
import { useChatStore } from '../stores/chatStore'

const store = useChatStore()
const { mode, lastError, backendStatus, trainerStatus, statusDetail } = storeToRefs(store)
const lunaProfile = lunaPresetRegistry.getProfile()

onMounted(async () => {
  await store.initialize()
  await store.applyCurrentModePreset().catch(() => {})
})
</script>

<template>
  <div class="grid full-grid">
    <aside class="surface panel">
      <h2>{{ lunaProfile.name }}</h2>
      <p class="muted">Persönliche Konfiguration für Handy und Laptop.</p>
      <img
        :src="lunaProfile.avatarProfileImage"
        alt="Luna Avatar"
        style="width: 96px; height: 96px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.2); margin: 8px 0 12px;"
      />

      <div class="row" style="margin-bottom:10px;">
        <button
          type="button"
          :disabled="mode === 'normal'"
          @click="store.setMode('normal')"
        >Normal</button>
        <button
          type="button"
          :disabled="mode === 'uncensored'"
          @click="store.setMode('uncensored')"
        >Uncensored</button>
      </div>

      <p class="muted">Aktiver Modus: <strong>{{ mode }}</strong></p>
      <p v-if="lastError" class="muted" style="color:#ffc1c1;">{{ lastError }}</p>

      <h3 style="margin-top:12px;">System</h3>
      <span class="chip">backend: {{ backendStatus }}</span>
      <span class="chip">trainer: {{ trainerStatus }}</span>
      <span v-if="statusDetail" class="chip">{{ statusDetail }}</span>
      <div style="margin-top: 8px;">
        <button type="button" @click="store.refreshSystemStatus()">Status aktualisieren</button>
      </div>

      <h3 style="margin-top:12px;">Preset Mapping</h3>
      <span class="chip">normal → {{ lunaPresetRegistry.resolvePresetId('normal') }}</span>
      <span class="chip">uncensored → {{ lunaPresetRegistry.resolvePresetId('uncensored') }}</span>
      <span class="chip">voice → {{ lunaProfile.voicePreset }}</span>
    </aside>

    <ChatWindow />
  </div>
</template>
