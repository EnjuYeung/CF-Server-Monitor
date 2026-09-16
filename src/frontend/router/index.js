import { createRouter, createWebHashHistory } from 'vue-router'
import { isAdminEntryPage } from '../utils/adminAccess.js'

const routes = [
  {
    path: '/',
    name: 'Dashboard',
    component: () => import('../views/Dashboard.vue')
  },
  {
    path: '/admin',
    name: 'Admin',
    component: () => import('../views/admin/index.vue')
  },
  {
    path: '/server/:id',
    name: 'Server',
    component: () => import('../views/ServerDetail.vue')
  }
]

const router = createRouter({
  history: createWebHashHistory(),
  routes
})

router.beforeEach(to => to.name === 'Admin' && !isAdminEntryPage ? '/' : true)

export default router
