import { onBeforeUnmount, ref } from 'vue'

// Push-to-talk with the browser's Web Speech API (free; Chrome/Edge/Safari).
// Hold the button to talk; the final transcript is passed to onResult.
export function usePushToTalk({ lang = 'de-DE', onResult } = {}) {
  const SpeechRecognition = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
  const supported = !!SpeechRecognition
  const listening = ref(false)
  const interim = ref('')
  const error = ref('')
  let recognition = null
  let finalText = ''

  function start() {
    if (!supported || listening.value) return
    error.value = ''
    interim.value = ''
    finalText = ''
    recognition = new SpeechRecognition()
    recognition.lang = lang
    recognition.interimResults = true
    recognition.continuous = true
    recognition.onresult = (event) => {
      let partial = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result.isFinal) finalText += result[0].transcript
        else partial += result[0].transcript
      }
      interim.value = (finalText + partial).trim()
    }
    recognition.onerror = (event) => {
      error.value = event.error === 'not-allowed' ? 'Mikrofon nicht erlaubt.' : `Spracheingabe: ${event.error}`
    }
    recognition.onend = () => {
      listening.value = false
      const text = (finalText || interim.value).trim()
      interim.value = ''
      if (text && onResult) onResult(text)
    }
    recognition.start()
    listening.value = true
  }

  function stop() {
    if (recognition && listening.value) recognition.stop()
  }

  onBeforeUnmount(() => recognition?.abort())

  return { supported, listening, interim, error, start, stop }
}
