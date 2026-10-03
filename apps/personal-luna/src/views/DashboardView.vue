<script setup>
import { computed, onMounted, ref } from 'vue'
import { cockpitApi, formatCents } from '../services/cockpitApi'

const data = ref(null)
const error = ref('')
const running = ref(false)

async function load() {
  error.value = ''
  try {
    data.value = await cockpitApi.dashboard()
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

onMounted(load)
</script>

<template>
  <div class="cockpit">
    <p v-if="error" class="error-text">{{ error }}</p>

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
        <ul v-if="data.metrics.length" class="plain-list">
          <li v-for="m in data.metrics" :key="`${m.source}-${m.metric}`">
            {{ m.source }} {{ m.metric }}: <strong>{{ m.value }}</strong>
            <span v-if="m.change24h != null" :class="m.change24h < 0 ? 'neg' : 'pos'">({{ m.change24h >= 0 ? '+' : '' }}{{ m.change24h }})</span>
          </li>
        </ul>
        <p v-else class="muted">Kommt mit den Verbindungen.</p>
      </section>

      <section class="surface panel tile">
        <h3>Verbindungen</h3>
        <span v-for="c in data.connectors" :key="c.id" class="chip">{{ c.label }}: {{ c.connected ? 'verbunden' : 'noch nicht' }}</span>
      </section>
    </div>
  </div>
</template>
