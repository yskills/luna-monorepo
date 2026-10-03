<script setup>
import { onMounted, ref } from 'vue'
import { cockpitApi, formatCents, parseAmountToCents } from '../services/cockpitApi'

const entries = ref([])
const summary = ref(null)
const error = ref('')
const today = () => new Date().toLocaleDateString('sv-SE')
const form = ref({ bookedOn: today(), amount: '', kind: 'expense', category: '', note: '' })

async function load() {
  const data = await cockpitApi.money()
  entries.value = data.entries
  summary.value = data.summary
}

async function add() {
  error.value = ''
  const cents = parseAmountToCents(form.value.amount)
  if (cents == null) {
    error.value = 'Betrag ungültig, z. B. 12,50'
    return
  }
  try {
    await cockpitApi.addMoney({
      bookedOn: form.value.bookedOn,
      amountCents: form.value.kind === 'expense' ? -Math.abs(cents) : Math.abs(cents),
      category: form.value.category,
      note: form.value.note,
    })
    form.value = { ...form.value, amount: '', note: '' }
    await load()
  } catch (e) {
    error.value = e.message
  }
}

async function remove(entry) {
  if (!window.confirm('Eintrag löschen?')) return
  try {
    await cockpitApi.deleteMoney(entry.id)
    await load()
  } catch (e) {
    error.value = e.message
  }
}

onMounted(() => load().catch((e) => { error.value = e.message }))
</script>

<template>
  <div class="cockpit">
    <p v-if="error" class="error-text">{{ error }}</p>

    <div v-if="summary" class="tiles">
      <section v-for="row in summary.current" :key="row.currency" class="surface panel tile">
        <h3>{{ summary.month }} · {{ row.currency }}</h3>
        <p class="big" :class="row.netCents < 0 ? 'neg' : 'pos'">{{ formatCents(row.netCents, row.currency) }}</p>
        <p class="muted">Ein {{ formatCents(row.incomeCents, row.currency) }} · Aus {{ formatCents(row.expenseCents, row.currency) }}</p>
      </section>
    </div>

    <form class="surface panel money-form" @submit.prevent="add">
      <select v-model="form.kind" aria-label="Art">
        <option value="expense">Ausgabe</option>
        <option value="income">Einnahme</option>
      </select>
      <input v-model="form.amount" class="field" inputmode="decimal" placeholder="Betrag (12,50)" required />
      <input v-model="form.bookedOn" class="field" type="date" required />
      <input v-model="form.category" class="field" maxlength="60" placeholder="Kategorie" />
      <input v-model="form.note" class="field" maxlength="300" placeholder="Notiz" />
      <button type="submit">Speichern</button>
    </form>

    <section class="surface panel">
      <h2>Letzte Einträge</h2>
      <ul class="plain-list items">
        <li v-for="entry in entries" :key="entry.id">
          <span>{{ entry.bookedOn }} · {{ entry.category || '—' }} <span class="muted">{{ entry.note }}</span></span>
          <span>
            <strong :class="entry.amountCents < 0 ? 'neg' : 'pos'">{{ formatCents(entry.amountCents, entry.currency) }}</strong>
            <button type="button" class="ghost small" aria-label="Eintrag löschen" @click="remove(entry)">✕</button>
          </span>
        </li>
      </ul>
      <p v-if="!entries.length" class="muted">Noch keine Einträge.</p>
    </section>
  </div>
</template>
