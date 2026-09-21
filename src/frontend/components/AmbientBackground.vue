<template>
  <div v-if="active" class="ambient-background" :class="{ 'ambient-paused': hidden }" aria-hidden="true">
    <div class="ambient-petals">
      <i v-for="(particle, index) in petals" :key="index" class="ambient-petal" :style="particle" />
    </div>
    <div class="ambient-stars">
      <i v-for="(particle, index) in stars" :key="index" class="ambient-star" :class="{ 'ambient-star-cross': index % 5 === 0 }" :style="particle" />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useAmbientMotion } from '../composables/useAmbientMotion'

const { active, hidden, compact } = useAmbientMotion()
// Fixed deterministic positions avoid layout changes and random regeneration on renders.
const petals = computed(() => Array.from({ length: compact.value ? 8 : 18 }, (_, i) => ({
  '--x': `${(i * 37 + 5) % 100}%`, '--size': `${8 + i % 4 * 2}px`,
  '--duration': `${19 + i % 7 * 3}s`, '--delay': `${-i * 3.7}s`,
  '--drift': `${(i % 2 ? -1 : 1) * (35 + i % 5 * 12)}px`
})))
const stars = computed(() => Array.from({ length: compact.value ? 16 : 32 }, (_, i) => ({
  '--x': `${(i * 43 + 3) % 100}%`, '--y': `${(i * 29 + 7) % 100}%`,
  '--size': `${i % 5 === 0 ? 7 : 2 + i % 2}px`,
  '--duration': `${4 + i % 5}s`, '--delay': `${-i * .8}s`
})))
</script>
