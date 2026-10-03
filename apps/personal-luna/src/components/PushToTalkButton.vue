<script setup>
import { usePushToTalk } from '../composables/usePushToTalk'

const props = defineProps({ lang: { type: String, default: 'de-DE' } })
const emit = defineEmits(['transcript'])

const { supported, listening, interim, error, start, stop } = usePushToTalk({
  lang: props.lang,
  onResult: (text) => emit('transcript', text),
})
</script>

<template>
  <div v-if="supported" class="ptt">
    <button
      type="button"
      class="ptt-button"
      :class="{ listening }"
      :aria-pressed="listening"
      title="Gedrückt halten zum Sprechen"
      @pointerdown.prevent="start"
      @pointerup="stop"
      @pointerleave="stop"
      @pointercancel="stop"
      @keydown.space.prevent="start"
      @keyup.space.prevent="stop"
    >🎤</button>
    <span v-if="listening" class="muted ptt-hint">{{ interim || 'Ich höre zu ...' }}</span>
    <span v-else-if="error" class="muted ptt-hint">{{ error }}</span>
  </div>
</template>
