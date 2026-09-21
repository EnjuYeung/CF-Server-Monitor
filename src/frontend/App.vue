<template>
  <div class="app-shell">
    <AmbientBackground />
    <router-view />
  </div>
</template>

<script setup>
import { useTheme } from './composables/useTheme'
import AmbientBackground from './components/AmbientBackground.vue'
import { initAmbientMotion } from './composables/useAmbientMotion'

const { initTheme } = useTheme()

initTheme()
initAmbientMotion()
</script>
