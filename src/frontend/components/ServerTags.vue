<template>
  <span
    v-for="(tag, index) in tags"
    :key="index"
    class="badge badge-tag"
    :style="{ backgroundColor: tag.background, color: tag.foreground }"
  >{{ tag.text }}</span>
  <span v-if="!tags.length && empty">{{ empty }}</span>
</template>

<script setup>
import { computed } from 'vue'
import { parseServerTags } from '../../shared/serverTags.js'

const props = defineProps({
  value: { type: String, default: '' },
  empty: { type: String, default: '' }
})
const tags = computed(() => parseServerTags(props.value))
</script>
