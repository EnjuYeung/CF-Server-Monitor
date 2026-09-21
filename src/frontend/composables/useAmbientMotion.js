import { computed, onMounted, onUnmounted, ref } from 'vue'

const KEY = 'ambient_motion'
const enabled = ref(true)
const reduced = ref(false)
const hidden = ref(false)
const compact = ref(false)
const active = computed(() => enabled.value && !reduced.value)

export function useAmbientMotion() {
  const toggle = () => {
    enabled.value = !enabled.value
    try { localStorage.setItem(KEY, enabled.value ? 'on' : 'off') } catch { /* Session preference still works. */ }
  }
  return { enabled, reduced, hidden, compact, active, toggle }
}

// One owner in App; no animation timer or per-frame reactive writes.
export function initAmbientMotion() {
  let motionQuery, sizeQuery
  const syncMotion = () => { reduced.value = motionQuery.matches }
  const syncSize = () => { compact.value = sizeQuery.matches }
  const syncVisibility = () => { hidden.value = document.hidden }
  const syncStorage = event => {
    if (event.key === KEY || event.key === null) enabled.value = event.newValue !== 'off'
  }
  onMounted(() => {
    try { enabled.value = localStorage.getItem(KEY) !== 'off' } catch { /* Keep default. */ }
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    sizeQuery = window.matchMedia('(max-width: 640px)')
    syncMotion(); syncSize(); syncVisibility()
    motionQuery.addEventListener('change', syncMotion)
    sizeQuery.addEventListener('change', syncSize)
    document.addEventListener('visibilitychange', syncVisibility)
    window.addEventListener('storage', syncStorage)
  })
  onUnmounted(() => {
    motionQuery?.removeEventListener('change', syncMotion)
    sizeQuery?.removeEventListener('change', syncSize)
    document.removeEventListener('visibilitychange', syncVisibility)
    window.removeEventListener('storage', syncStorage)
  })
}
