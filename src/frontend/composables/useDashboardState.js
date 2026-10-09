import { onUnmounted } from 'vue'
import { createDashboardState } from '../state/dashboardState.js'
import { createLiveSocket, fetchConfig, getApiBases } from '../utils/api.js'
import { getTitle } from '../utils/config.js'
import { http } from '../utils/http.js'

export function useDashboardState(appConfig) {
  const session = createDashboardState({
    getSources: getApiBases,
    getTitle,
    loadConfig: async () => appConfig || await fetchConfig(),
    fetchSnapshots: (onResult, signal) => http.getAllWithProgress('/api/servers', onResult, { signal }),
    connect: (_source, index, ids, handlers) => createLiveSocket('all', {
      ...handlers, replay: false, timeoutMinutes: 0, reconnectForever: true
    }, index, ids),
    now: () => Date.now(),
    every: (callback, delay) => setInterval(callback, delay),
    cancel: timer => clearInterval(timer),
    isHidden: () => document.hidden,
    onRestore(callback) {
      const events = [[document, 'visibilitychange'], [document, 'resume'],
        [window, 'focus'], [window, 'online'], [window, 'pageshow']]
      for (const [target, type] of events) target.addEventListener(type, callback)
      return () => { for (const [target, type] of events) target.removeEventListener(type, callback) }
    },
    onError: error => console.info('[INFO] Dashboard refresh pending...', error)
  }, appConfig || {})
  onUnmounted(session.stop)
  return session
}
