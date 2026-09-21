<template>
  <div class="terminal-header">
    <a href="/#/" class="dream-brand" :aria-label="title"><span class="dream-brand-flower" aria-hidden="true">✿</span><span class="dream-brand-title">{{ title }}</span></a>
    <div class="terminal-header-controls">
      <button type="button" class="header-control motion-btn" :aria-label="motionLabel" :title="motionLabel" :aria-pressed="active" :disabled="reduced" @click="toggle">
        <span aria-hidden="true">{{ active ? '❋' : '◌' }}</span>
      </button>
      <button
        type="button"
        class="header-control lang-btn"
        @click="toggleLanguage"
        :aria-label="languageLabel"
        :title="languageLabel"
      >{{ languageSymbol }}</button>
      <button
        type="button"
        class="header-control theme-btn"
        @click="toggleTheme"
        :aria-label="themeLabel"
        :title="themeLabel"
      >
        <svg v-if="currentTheme === 'auto'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="20" height="14" x="2" y="3" rx="2"></rect><line x1="8" x2="16" y1="21" y2="21"></line><line x1="12" x2="12" y1="17" y2="21"></line></svg>
        <svg v-else-if="currentTheme === 'dark'" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"></path></svg>
        <svg v-else aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2"></path><path d="M12 20v2"></path><path d="m4.93 4.93 1.41 1.41"></path><path d="m17.66 17.66 1.41 1.41"></path><path d="M2 12h2"></path><path d="M20 12h2"></path><path d="m6.34 17.66-1.41 1.41"></path><path d="m19.07 4.93-1.41 1.41"></path></svg>
      </button>
      <a v-if="isAdminPage" href="/#/" class="header-control admin-link-header" :aria-label="trans.dashboard" :title="trans.dashboard"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-home">
  <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0a1 1 0 01-1-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 01-1 1h-2z"/>
</svg></a>
      <a v-else-if="adminAccess.authorized" :href="adminHref" :aria-label="trans.settings" :title="trans.settings" class="header-control admin-link-header"><svg aria-hidden="true" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="lucide lucide-settings"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg></a>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useTranslation, currentLang, toggleLanguage } from '../utils/i18n'
import { useTheme } from '../composables/useTheme'
import { DEFAULT_SITE_TITLE } from '../utils/constants'
import { adminAccess } from '../utils/adminAccess.js'
import { useAmbientMotion } from '../composables/useAmbientMotion'

defineProps({
  title: {
    type: String,
    default: DEFAULT_SITE_TITLE
  }
})

const { currentTheme, toggleTheme } = useTheme()
const trans = useTranslation()
const { active, reduced, toggle } = useAmbientMotion()
const motionLabel = computed(() => reduced.value ? trans.value.motionReduced : active.value ? trans.value.motionDisable : trans.value.motionEnable)
const languageSymbol = computed(() => ({ en: 'EN', zh: '中', ja: '日' })[currentLang.value])
const languageLabel = computed(() => `${trans.value.switchLanguage}: ${trans.value[{
  en: 'languageEnglish', zh: 'languageChinese', ja: 'languageJapanese'
}[currentLang.value]]}`)
const themeLabel = computed(() => `${trans.value.switchTheme}: ${trans.value[{
  auto: 'themeAuto', dark: 'themeDark', light: 'themeLight'
}[currentTheme.value]]}`)
const route = useRoute()
const isAdminPage = computed(() => route.path === '/admin')
const adminHref = computed(() => adminAccess.path)

</script>
