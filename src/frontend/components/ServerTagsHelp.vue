<template>
  <HelpTooltip :aria-label="trans.tags">
    <span>{{ trans.tagsHelpFormat }}</span>
    <span>{{ trans.tagsHelpColors }}</span>
    <span v-for="(color, name) in TAG_COLORS" :key="name" class="help-tooltip-row">
      <span class="help-tooltip-label"><ServerTags :value="`${name}<${name}>`" /></span>
      <span class="help-tooltip-value">{{ color }}</span>
    </span>
    <span>{{ trans.tagsHelpDefault }}</span>
    <span>{{ trans.tagsHelpLimits }}</span>
  </HelpTooltip>
</template>

<script setup>
import HelpTooltip from './HelpTooltip.vue'
import ServerTags from './ServerTags.vue'
import { TAG_COLORS } from '../../shared/serverTags.js'
import { useTranslation } from '../utils/i18n.js'

const trans = useTranslation()
</script>
