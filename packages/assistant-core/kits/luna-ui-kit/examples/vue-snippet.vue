<template>
  <div class="luna-assistant-shell">
    <button class="luna-assistant-fab" @click="toggleOpen" aria-label="Toggle Assistant" type="button">
      {{ open ? '×' : '✦' }}
    </button>

    <aside class="luna-chat" :class="{ open }" :data-conversation="conversationMode ? 'on' : 'off'">
      <div class="luna-chat__head glass">
        <div class="luna-chat__profile">
          <img class="luna-chat__avatar" :src="avatarUrl" alt="Luna" />
          <div>
            <h2 class="luna-chat__title">{{ characterName }}</h2>
            <small class="luna-chat__status" :class="llmEnabled ? 'ok' : 'warn'">{{ llmEnabled ? 'Live LLM' : 'Fallback' }}</small>
          </div>
        </div>
        <div class="luna-chat__head-actions">
          <button class="luna-chat__icon-btn" type="button" @click="showCharacterPicker = true">👤</button>
          <button class="luna-chat__icon-btn" type="button" @click="settingsOpen = !settingsOpen">⚙</button>
          <button class="luna-chat__icon-btn" type="button" @click="open = false">×</button>
        </div>
      </div>

      <div class="luna-chat__tabs glass">
        <span class="luna-chat__chip">{{ settingsOpen ? 'Settings' : 'Chat' }}</span>
        <button class="luna-chat__btn" type="button" @click="toggleMode">{{ mode === 'uncensored' ? '●' : '○' }}</button>
      </div>

      <div class="luna-chat__body">
        <div :class="['luna-chat__conversation-avatar', voiceState]">
          <img class="luna-chat__conversation-pfp" :src="avatarUrl" alt="Luna Gespräch" />
        </div>
        <div class="luna-chat__hint">{{ conversationMode ? 'Gespräch aktiv' : 'Avatar + Sprache nur im Gesprächsmodus' }}</div>

        <div class="luna-chat__log">
          <article v-for="m in messages" :key="m.id" :class="['luna-chat__msg', m.role]">
            <div class="luna-chat__msg-avatar">{{ m.role === 'user' ? 'U' : 'L' }}</div>
            <div class="luna-chat__msg-stack">
              <figure v-if="m.type === 'image' && isLunaImageUrl(m.image?.url)" class="luna-chat__image">
                <img :src="m.image.url" :alt="m.image.prompt || 'Bild von Luna'" loading="lazy" />
                <span v-if="m.image.localOnly" class="luna-chat__image-badge">nur lokal</span>
              </figure>
              <div v-else class="luna-chat__bubble">{{ m.text }}</div>
              <div class="luna-chat__meta">{{ m.role === 'user' ? 'DU' : 'LUNA' }} · {{ formatTime(m.createdAt) }}</div>
            </div>
          </article>
        </div>

        <footer class="luna-chat__composer">
          <div class="luna-chat__voice-status" :class="voiceState">{{ voiceLabel }}</div>
          <textarea v-model="input" class="luna-chat__input" placeholder="Schreib hier..." @keydown.enter.exact.prevent="send" />
          <button class="luna-chat__btn" :class="{ active: conversationMode }" type="button" @click="toggleConversation">◉</button>
          <button class="luna-chat__btn" type="button" @click="startVoice">🎤</button>
          <button class="luna-chat__btn" type="button" title="Bild erzeugen" @click="sendImage">🖼</button>
          <button class="luna-chat__btn luna-chat__btn--accent" type="button" @click="send">→</button>
        </footer>
      </div>

      <div class="luna-chat__overlay" :class="{ open: showCharacterPicker }" @click.self="showCharacterPicker = false">
        <div class="luna-chat__overlay-card glass">
          <h4>Chatbot wählen</h4>
          <p>Wähle deinen aktiven Assistant</p>
          <button class="luna-chat__btn" type="button" @click="selectCharacter('luna')">Luna</button>
          <button class="luna-chat__btn" type="button" @click="selectCharacter('eva')">Eva</button>
        </div>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue';

const PANEL_PREFS_KEY = 'assistantPanelPrefs';
const PANEL_MESSAGES_KEY = 'assistantMessagesByCharacter';
const PRESET_NORMAL_ID = 'luna-tsundere';
const PRESET_UNCENSORED_ID = 'luna-uncensored-explicit';

const open = ref(true);
const settingsOpen = ref(false);
const llmEnabled = ref(true);
const mode = ref('normal');
const characterId = ref('luna');
const showCharacterPicker = ref(false);
const conversationMode = ref(false);
const input = ref('');
const messagesByCharacter = ref({});
const voiceState = ref('idle');
const voiceLabel = ref('🎙️ Voice bereit');

const avatarUrl = computed(() => 'https://api.dicebear.com/9.x/lorelei/svg?seed=luna-cute-egirl');
const characterName = computed(() => characterId.value === 'eva' ? 'Eva' : 'Luna');
const messages = computed(() => messagesByCharacter.value[characterId.value] || []);

function formatTime(value) {
  return new Date(value || Date.now()).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

// Only images served by the Luna API are rendered.
function isLunaImageUrl(url = '') {
  return /^\/assistant\/image\/[0-9a-f-]{36}$/.test(String(url || ''));
}

function normalizeMessage(message = {}) {
  return {
    id: message.id || `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    role: message.role === 'user' ? 'user' : 'assistant',
    type: message.type === 'image' ? 'image' : 'text',
    text: String(message.text || ''),
    image: message.type === 'image' ? message.image || null : null,
    createdAt: message.createdAt || new Date().toISOString(),
  };
}

function pushMessage(role, text, extra = {}) {
  const current = [...messages.value, normalizeMessage({ role, text, ...extra })];
  messagesByCharacter.value = { ...messagesByCharacter.value, [characterId.value]: current };
  saveMessagesStore();
}

function loadPanelPrefs() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_PREFS_KEY) || '{}');
    if (typeof parsed.open === 'boolean') open.value = parsed.open;
    if (parsed.mode === 'normal' || parsed.mode === 'uncensored') mode.value = parsed.mode;
    if (typeof parsed.characterId === 'string' && parsed.characterId) characterId.value = parsed.characterId;
  } catch {
    // ignore
  }
}

function savePanelPrefs() {
  localStorage.setItem(PANEL_PREFS_KEY, JSON.stringify({
    open: open.value,
    mode: mode.value,
    characterId: characterId.value,
  }));
}

function loadMessagesStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_MESSAGES_KEY) || '{}');
    if (parsed && typeof parsed === 'object') {
      const normalized = {};
      Object.keys(parsed).forEach((key) => {
        normalized[key] = Array.isArray(parsed[key]) ? parsed[key].map((item) => normalizeMessage(item)) : [];
      });
      messagesByCharacter.value = normalized;
    }
  } catch {
    messagesByCharacter.value = {};
  }
}

function saveMessagesStore() {
  localStorage.setItem(PANEL_MESSAGES_KEY, JSON.stringify(messagesByCharacter.value));
}

function toggleOpen() {
  open.value = !open.value;
}

function toggleConversation() {
  conversationMode.value = !conversationMode.value;
  if (!conversationMode.value) {
    voiceState.value = 'idle';
    voiceLabel.value = '🎙️ Gespräch pausiert';
    return;
  }
  voiceState.value = 'listening';
  voiceLabel.value = '🎙️ Gespräch aktiv';
}

function toggleMode() {
  mode.value = mode.value === 'uncensored' ? 'normal' : 'uncensored';
  pushMessage('assistant', mode.value === 'uncensored' ? 'Uncensored Mode aktiv.' : 'Zurück im Normalmodus.');
  applyPresetForMode(mode.value);
}

function selectCharacter(nextCharacterId) {
  characterId.value = nextCharacterId;
  showCharacterPicker.value = false;
}

async function send() {
  if (!input.value.trim()) return;
  const userMessage = input.value.trim();
  input.value = '';
  pushMessage('user', userMessage);

  if (conversationMode.value) {
    voiceState.value = 'speaking';
    voiceLabel.value = '🔊 Luna spricht ...';
  }

  try {
    const res = await fetch('/assistant/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: characterId.value, mode: mode.value, message: userMessage }),
    });
    const out = await res.json();
    pushMessage('assistant', out?.reply || '(leer)');
    llmEnabled.value = out?.llmEnabled !== false;
    if (conversationMode.value) {
      voiceState.value = 'listening';
      voiceLabel.value = '🎙️ Gespräch aktiv';
    }
  } catch {
    pushMessage('assistant', '⚠️ API nicht erreichbar.');
    llmEnabled.value = false;
    voiceState.value = 'idle';
    voiceLabel.value = '🎙️ Voice bereit';
  }
}

async function sendImage() {
  const prompt = input.value.trim();
  if (!prompt) return;
  input.value = '';
  pushMessage('user', `🖼 ${prompt}`);
  try {
    const res = await fetch('/assistant/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: characterId.value, mode: mode.value, prompt }),
    });
    const out = await res.json();
    if (out?.type === 'image' && out.image) {
      pushMessage('assistant', '', { type: 'image', image: { ...out.image, prompt } });
    } else {
      pushMessage('assistant', out?.reply || `⚠️ ${out?.error?.message || 'Fehler'}`);
    }
  } catch {
    pushMessage('assistant', '⚠️ API nicht erreichbar.');
  }
}

function startVoice() {
  if (!conversationMode.value) {
    pushMessage('assistant', '🎙️ Sprache nur im Gesprächsmodus aktiv.');
    return;
  }
  voiceState.value = 'listening';
  voiceLabel.value = '🎤 Höre zu... (STT-Provider hier anschließen)';
}

async function applyPresetForMode(targetMode = 'normal') {
  const presetId = targetMode === 'uncensored' ? PRESET_UNCENSORED_ID : PRESET_NORMAL_ID;
  try {
    await fetch('/assistant/luna/presets/apply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ characterId: characterId.value, presetId, mode: targetMode }),
    });
  } catch {
    // preset endpoint optional in consumer projects
  }
}

watch([open, mode, characterId], () => {
  savePanelPrefs();
});

onMounted(() => {
  loadPanelPrefs();
  loadMessagesStore();
  applyPresetForMode(mode.value);
  if (!messages.value.length) {
    pushMessage('assistant', 'Hey cutie ✨ Was ist dein Fokus für jetzt?');
  }
});
</script>
