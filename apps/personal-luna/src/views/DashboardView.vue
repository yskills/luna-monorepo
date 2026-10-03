<script setup>
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

const data = ref(null)
const error = ref('')
const running = ref(false)
import { cockpitApi, formatCents } from '../services/cockpitApi'

const route = useRoute()
const router = useRouter()
const mail = ref(null)
const mailError = ref('')
const notice = ref('')

const CONNECT_NOTICES = {
  'outlook-ok': 'Outlook ist verbunden.',
  'outlook-declined': 'Outlook-Verbindung abgebrochen.',
  'outlook-failed': 'Outlook-Verbindung fehlgeschlagen. Bitte erneut versuchen.',
}

const outlook = computed(() => data.value?.connectors.find((c) => c.id === 'outlook'))

async function loadMail(refresh = false) {
  mailError.value = ''
  if (!outlook.value?.connected) {
    mail.value = null
    return
  }
  try {
    mail.value = (await cockpitApi.outlookSummary(refresh)).outlook
  } catch (e) {
    mailError.value = e.message
  }
}

async function disconnectOutlook() {
  if (!window.confirm('Outlook trennen?')) return
  await cockpitApi.disconnectOutlook()
  await load()
}

const metrics = computed(() => (data.value?.metrics || []).filter((m) => m.source !== 'outlook'))

const timeOf = (iso) => String(iso || '').slice(11, 16)


async function load() {
  error.value = ''
  try {
    data.value = await cockpitApi.dashboard()
    await loadMail()
  } catch (e) {
    error.value = e.message
  }
}

async function runBriefing() {
  running.value = true
  error.value = ''
  try {
    const { briefing } = await cockpitApi.runBriefing()
    data.value = { ...data.value, briefing }
  } catch (e) {
    error.value = e.message
  } finally {
    running.value = false
  }
}

const briefingTime = computed(() => data.value?.briefing
  ? new Date(data.value.briefing.createdAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
  : '')

const previousNet = (currency) => data.value?.money.previous.find((row) => row.currency === currency)?.netCents

onMounted(() => {
  const connect = String(route.query.connect || '')
  if (CONNECT_NOTICES[connect]) {
    notice.value = CONNECT_NOTICES[connect]
    router.replace({ query: {} })
  }
  load()
})
</script>

<template>
  <div class="cockpit">
    <p v-if="error" class="error-text">{{ error }}</p>
    <p v-if="notice" class="muted">{{ notice }}</p>

    <section class="surface panel briefing-card">
      <div class="card-head">
        <h2>Briefing</h2>
        <button type="button" :disabled="running" @click="runBriefing">{{ running ? 'Läuft ...' : 'Jetzt erstellen' }}</button>
      </div>
      <template v-if="data?.briefing">
        <p class="briefing-text">{{ data.briefing.summary }}</p>
        <p class="muted">{{ briefingTime }} · {{ data.briefing.summarySource === 'plain' ? 'ohne KI (Modell offline)' : 'lokales Modell' }}</p>
      </template>
      <p v-else class="muted">Noch kein Briefing. Es kommt täglich automatisch oder per Knopf.</p>
    </section>

    <div v-if="data" class="tiles">
      <section v-if="outlook?.connected" class="surface panel tile wide-tile">
        <div class="card-head">
          <h3>Mail · {{ outlook.account }}</h3>
          <button type="button" class="ghost small" @click="loadMail(true)">↻</button>
        </div>
        <p v-if="mailError" class="error-text">{{ mailError }}</p>
        <template v-if="mail">
          <p class="big">{{ mail.unreadCount }} <span class="muted">ungelesen</span></p>
          <ul class="plain-list items">
            <li v-for="m in mail.unread" :key="m.receivedAt + m.subject">
              <span><strong v-if="m.important" class="neg">! </strong>{{ m.subject }}</span>
              <span class="muted">{{ m.from }}</span>
            </li>
          </ul>
          <h3 class="spaced">Heute</h3>
          <ul v-if="mail.events.length" class="plain-list items">
            <li v-for="e in mail.events" :key="e.start + e.subject">
              <span>{{ e.allDay ? 'ganztägig' : `${timeOf(e.start)}–${timeOf(e.end)}` }}</span>
              <span>{{ e.subject }} <span class="muted">{{ e.location }}</span></span>
            </li>
          </ul>
          <p v-else class="muted">Keine Termine.</p>
        </template>
      </section>

      <RouterLink to="/money" class="surface panel tile">
        <h3>Geld {{ data.money.month }}</h3>
        <template v-if="data.money.current.length">
          <p v-for="row in data.money.current" :key="row.currency" class="big" :class="row.netCents < 0 ? 'neg' : 'pos'">
            {{ formatCents(row.netCents, row.currency) }}
          </p>
          <p v-for="row in data.money.current" :key="`${row.currency}-p`" class="muted">
            <template v-if="previousNet(row.currency) != null">Vormonat {{ formatCents(previousNet(row.currency), row.currency) }}</template>
          </p>
        </template>
        <p v-else class="muted">Noch keine Einträge.</p>
      </RouterLink>

      <RouterLink to="/lists" class="surface panel tile">
        <h3>Offene Aufgaben</h3>
        <p class="big">{{ data.openTodos }}</p>
      </RouterLink>

      <section class="surface panel tile">
        <h3>Kennzahlen</h3>
        <ul v-if="metrics.length" class="plain-list">
          <li v-for="m in metrics" :key="`${m.source}-${m.metric}`">
            {{ m.source }} {{ m.metric }}: <strong>{{ m.value }}</strong>
            <span v-if="m.change24h != null" :class="m.change24h < 0 ? 'neg' : 'pos'">({{ m.change24h >= 0 ? '+' : '' }}{{ m.change24h }})</span>
          </li>
        </ul>
        <p v-else class="muted">Kommt mit den Verbindungen.</p>
      </section>

      <section class="surface panel tile">
        <h3>Verbindungen</h3>
        <div v-for="c in data.connectors" :key="c.id" class="connector-row">
          <span class="chip">{{ c.label }}: {{ c.connected ? 'verbunden' : 'noch nicht' }}</span>
          <template v-if="c.id === 'outlook'">
            <button v-if="c.connected" type="button" class="ghost small" @click="disconnectOutlook">Trennen</button>
            <button v-else-if="c.configured" type="button" class="small" @click="cockpitApi.connectOutlook()">Verbinden</button>
            <span v-else class="muted">Server-Einrichtung fehlt</span>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>
