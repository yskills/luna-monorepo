import { createRouter, createWebHistory } from 'vue-router'
import FullAssistantView from '../views/FullAssistantView.vue'
import ChatOnlyView from '../views/ChatOnlyView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'full', component: FullAssistantView },
    { path: '/chat', name: 'chat-only', component: ChatOnlyView },
  ],
})

export default router
