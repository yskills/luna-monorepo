<script setup>
import { onMounted, ref } from 'vue'
import { cockpitApi } from '../services/cockpitApi'
import PushToTalkButton from '../components/PushToTalkButton.vue'

const lists = ref([])
const newList = ref('')
const drafts = ref({})
const error = ref('')

async function guard(action) {
  error.value = ''
  try {
    await action()
    lists.value = (await cockpitApi.lists()).lists
  } catch (e) {
    error.value = e.message
  }
}

const createList = () => newList.value.trim() && guard(async () => {
  await cockpitApi.createList(newList.value.trim())
  newList.value = ''
})

const addItem = (list) => (drafts.value[list.id] || '').trim() && guard(async () => {
  await cockpitApi.addItem(list.id, drafts.value[list.id].trim())
  drafts.value[list.id] = ''
})

const toggle = (item) => guard(() => cockpitApi.updateItem(item.id, { done: !item.done }))
const removeItem = (item) => guard(() => cockpitApi.deleteItem(item.id))
const removeList = (list) => window.confirm(`Liste "${list.title}" löschen?`) && guard(() => cockpitApi.deleteList(list.id))

onMounted(() => guard(async () => {}))
</script>

<template>
  <div class="cockpit">
    <p v-if="error" class="error-text">{{ error }}</p>
    <form class="surface panel inline-form" @submit.prevent="createList">
      <input v-model="newList" class="field" maxlength="120" placeholder="Neue Liste, z. B. Einkauf" />
      <button type="submit" :disabled="!newList.trim()">Anlegen</button>
    </form>

    <section v-for="list in lists" :key="list.id" class="surface panel">
      <div class="card-head">
        <h2>{{ list.title }} <span class="muted">({{ list.openCount }} offen)</span></h2>
        <button type="button" class="ghost" @click="removeList(list)">Löschen</button>
      </div>
      <ul class="plain-list items">
        <li v-for="item in list.items" :key="item.id" :class="{ done: item.done }">
          <label><input type="checkbox" :checked="item.done" @change="toggle(item)" /> {{ item.text }}</label>
          <button type="button" class="ghost small" aria-label="Eintrag löschen" @click="removeItem(item)">✕</button>
        </li>
      </ul>
      <form class="inline-form" @submit.prevent="addItem(list)">
        <input v-model="drafts[list.id]" class="field" maxlength="500" placeholder="Neuer Eintrag" />
        <PushToTalkButton @transcript="(text) => (drafts[list.id] = text)" />
        <button type="submit">+</button>
      </form>
    </section>
    <p v-if="!lists.length" class="muted">Noch keine Listen.</p>
  </div>
</template>
