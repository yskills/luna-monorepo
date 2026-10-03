import { createRouter, createWebHistory } from 'vue-router'
import FullAssistantView from '../views/FullAssistantView.vue'
import ChatOnlyView from '../views/ChatOnlyView.vue'
import LoginView from '../views/LoginView.vue'
import { useAuthStore } from '../stores/authStore'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/', name: 'full', component: FullAssistantView },
    { path: '/chat', name: 'chat-only', component: ChatOnlyView },
  ],
})

router.beforeEach(async (to) => {
  const auth = useAuthStore()
  if (!auth.checked) {
    await auth.check()
  }
  if (to.meta.public) {
    return auth.authenticated && to.name === 'login' ? { path: '/' } : true
  }
  if (!auth.authenticated) {
    return { name: 'login', query: to.fullPath !== '/' ? { redirect: to.fullPath } : {} }
  }
  return true
})

export default router
