import { createRouter, createWebHistory } from 'vue-router'
import FullAssistantView from '../views/FullAssistantView.vue'
import ChatOnlyView from '../views/ChatOnlyView.vue'
import LoginView from '../views/LoginView.vue'
import DashboardView from '../views/DashboardView.vue'
import ListsView from '../views/ListsView.vue'
import MoneyView from '../views/MoneyView.vue'
import ActionsView from '../views/ActionsView.vue'
import { useAuthStore } from '../stores/authStore'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/login', name: 'login', component: LoginView, meta: { public: true } },
    { path: '/', name: 'dashboard', component: DashboardView },
    { path: '/luna', name: 'full', component: FullAssistantView },
    { path: '/lists', name: 'lists', component: ListsView },
    { path: '/money', name: 'money', component: MoneyView },
    { path: '/actions', name: 'actions', component: ActionsView },
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
