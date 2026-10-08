<script setup>
import { computed, onMounted, ref } from 'vue'
import { cockpitApi } from '../services/cockpitApi'

const actions = ref([])
const error = ref('')
const busy = ref(0)
const editing = ref(0)
const draft = ref({ to: '', subject: '', body: '' })
const showDone = ref(true)
const notice = ref('')
let noticeTimer

const STATUS_LABELS = {
  pending: 'Wartet auf dich',
  sending: 'wird gesendet',
  sent: 'gesendet',
  failed: 'fehlgeschlagen',
  blocked: 'blockiert',
  rejected: 'verworfen',
}

const open = computed(() => actions.value.filter((a) => ['pending', 'failed', 'blocked', 'sending'].includes(a.status)))
const done = computed(() => actions.value.filter((a) => ['sent', 'rejected'].includes(a.status)))

async function load() {
  error.value = ''
  try {
    actions.value = (await cockpitApi.actions()).actions
  } catch (e) {
    error.value = e.message
  }
}

async function run(id, fn) {
  busy.value = id
  error.value = ''
  try {
    await fn()
    await load()
  } catch (e) {
    error.value = e.message
  } finally {
    busy.value = 0
  }
}

function startEdit(action) {
  editing.value = action.id
  draft.value = { to: action.payload.to.join(', '), subject: action.payload.subject, body: action.payload.body }
}

const saveEdit = (action) => run(action.id, async () => {
  await cockpitApi.editAction(action.id, {
    ...action.payload,
    to: draft.value.to.split(/[,;\s]+/).filter(Boolean),
    subject: draft.value.subject,
    body: draft.value.body,
  })
  editing.value = 0
})

function flash(text) {
  notice.value = text
  clearTimeout(noticeTimer)
  noticeTimer = setTimeout(() => { notice.value = '' }, 4000)
}

const approve = (action) => {
  const to = action.payload.to.join(', ')
  const question = action.status === 'failed'
    ? `Erneut an ${to} senden? Prüfe vorher in Outlook unter „Gesendet“, ob die Mail nicht doch schon raus ist.`
    : `Mail an ${to} jetzt senden?`
  if (!window.confirm(question)) return
  run(action.id, async () => {
    const { action: result } = await cockpitApi.approveAction(action.id)
    if (result.status === 'sent') flash(`Gesendet an ${to}.`)
  })
}
const reject = (action) => run(action.id, () => cockpitApi.rejectAction(action.id))

function when(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date().getFullYear()
  return d.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', ...(sameYear ? {} : { year: '2-digit' }), hour: '2-digit', minute: '2-digit' })
}

onMounted(load)
</script>

<template>
  <div class="cockpit narrow">
    <header class="page-head">
      <h2>Freigaben</h2>
      <p class="muted">Luna sendet nichts ohne dein OK.</p>
    </header>
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="notice" class="muted" role="status">{{ notice }}</p>

    <article v-for="a in open" :key="a.id" class="surface panel action-card">
      <div class="action-head">
        <span class="status-chip" :class="`status-${a.status}`">{{ STATUS_LABELS[a.status] }}</span>
        <span class="muted">{{ a.source === 'luna' ? 'Entwurf von Luna' : 'Von dir' }} · {{ when(a.createdAt) }}</span>
      </div>

      <template v-if="editing === a.id">
        <label class="field-label">An<input v-model="draft.to" class="field" /></label>
        <label class="field-label">Betreff<input v-model="draft.subject" class="field" maxlength="200" :disabled="!!a.payload.replyToMessageId" /></label>
        <p v-if="a.payload.replyToMessageId" class="muted">Antworten behalten den Betreff der ursprünglichen Mail.</p>
        <label class="field-label">Text<textarea v-model="draft.body" class="field" rows="8" /></label>
        <div class="button-stack">
          <button type="button" :disabled="busy === a.id" @click="saveEdit(a)">Speichern</button>
          <button type="button" class="text-button" @click="editing = 0">Abbrechen</button>
        </div>
      </template>
      <template v-else>
        <dl class="action-fields">
          <dt>An</dt><dd>{{ a.payload.to.join(', ') }}</dd>
          <dt>Betreff</dt><dd>{{ a.payload.subject }}</dd>
        </dl>
        <p class="action-body">{{ a.payload.body }}</p>
        <p v-if="a.error" class="error-text">{{ a.error }}</p>
        <div v-if="a.status !== 'sending'" class="button-stack">
          <button v-if="a.status !== 'blocked'" type="button" :disabled="busy === a.id" @click="approve(a)">
            {{ busy === a.id ? 'Sendet …' : a.status === 'failed' ? 'Erneut senden' : 'Freigeben und senden' }}
          </button>
          <button v-if="a.status === 'pending'" type="button" class="ghost" :disabled="busy === a.id" @click="startEdit(a)">Bearbeiten</button>
          <button type="button" class="text-button danger" :disabled="busy === a.id" @click="reject(a)">Verwerfen</button>
        </div>
      </template>
    </article>

    <p v-if="!open.length" class="muted">
      Nichts wartet auf dich. Antworte im Cockpit auf eine Mail, dann landet Lunas Entwurf hier.
    </p>

    <section v-if="done.length">
      <div class="card-head">
        <h3>Erledigt</h3>
        <button type="button" class="text-button" @click="showDone = !showDone">{{ showDone ? 'Ausblenden' : 'Anzeigen' }}</button>
      </div>
      <ul v-if="showDone" class="plain-list done-list">
        <li v-for="a in done" :key="a.id">
          <span>{{ a.payload.subject }}</span>
          <span class="muted">an {{ a.payload.to.join(', ') }} · {{ STATUS_LABELS[a.status] }} <span class="nums">{{ when(a.sentAt || a.decidedAt) }}</span></span>
        </li>
      </ul>
    </section>
  </div>
</template>
