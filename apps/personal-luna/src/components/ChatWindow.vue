<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../stores/chatStore'
import PushToTalkButton from './PushToTalkButton.vue'

const store = useChatStore()
const { messages, loading } = storeToRefs(store)

const draft = ref('')
const messageBox = ref(null)

const canSend = computed(() => draft.value.trim().length > 0 && !loading.value)

function onTranscript(text) {
  draft.value = draft.value.trim() ? `${draft.value.trim()} ${text}` : text
}

async function send() {
  if (!canSend.value) return
  const payload = draft.value
  draft.value = ''
  await store.sendMessage(payload)
}

async function sendImage() {
  if (!canSend.value) return
  const payload = draft.value
  draft.value = ''
  await store.sendImage(payload)
}

// Only images served by Luna's own API are rendered.
function isLunaImage(item) {
  return item.type === 'image' && /^\/assistant\/image\/[0-9a-f-]{36}$/.test(String(item.image?.url || ''))
}

watch(
  () => messages.value.length,
  async () => {
    await nextTick()
    if (messageBox.value) {
      messageBox.value.scrollTop = messageBox.value.scrollHeight
    }
  },
)
</script>

<template>
  <section class="surface chat-window">
    <div ref="messageBox" class="messages">
      <article
        v-for="item in messages"
        :key="item.id"
        class="msg"
        :class="[item.role, { image: isLunaImage(item) }]"
      >
        <figure v-if="isLunaImage(item)" class="msg-image">
          <img :src="item.image.url" :alt="item.image.prompt || 'Bild von Luna'" loading="lazy" />
          <figcaption v-if="item.image.localOnly" class="chip">nur lokal</figcaption>
        </figure>
        <template v-else>{{ item.text }}</template>
      </article>
      <p v-if="loading" class="muted">Luna denkt ...</p>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        placeholder="Schreib Luna eine Nachricht..."
        @keydown.enter.exact.prevent="send"
      />
      <PushToTalkButton @transcript="onTranscript" />
      <button type="button" :disabled="!canSend" title="Text als Bildbeschreibung senden" @click="sendImage">Bild</button>
      <button type="submit" :disabled="!canSend">Senden</button>
    </form>
  </section>
</template>
