<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useChatStore } from '../stores/chatStore'

const store = useChatStore()
const { messages, loading } = storeToRefs(store)

const draft = ref('')
const messageBox = ref(null)

const canSend = computed(() => draft.value.trim().length > 0 && !loading.value)

async function send() {
  if (!canSend.value) return
  const payload = draft.value
  draft.value = ''
  await store.sendMessage(payload)
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
        :class="item.role"
      >
        {{ item.text }}
      </article>
      <p v-if="loading" class="muted">Luna denkt ...</p>
    </div>

    <form class="composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        placeholder="Schreib Luna eine Nachricht..."
        @keydown.enter.exact.prevent="send"
      />
      <button type="submit" :disabled="!canSend">Senden</button>
    </form>
  </section>
</template>
