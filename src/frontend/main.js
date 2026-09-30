import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import './styles/main.css'
import './styles/light.css'
import { applyDefaultLanguage, currentLang, resolveLanguagePreference, translations } from './utils/i18n'
import { http, clearAuthToken } from './utils/http'
import { isAdminEntryPage, updateAdminAccess } from './utils/adminAccess.js'
import { initConfig } from './utils/config'
import { LAST_AGENT_VERSION, VERSION } from './utils/api'
import { applyDefaultTheme } from './composables/useTheme'
const getTranslation = () => {
  const lang = currentLang.value || resolveLanguagePreference(localStorage.getItem('language_preference') || 'auto')
  return translations[lang] || translations.en
}

const trans = () => getTranslation()

async function initApp() {
  if (isAdminEntryPage) await router.replace({ path: '/admin', query: Object.fromEntries(new URLSearchParams(window.location.search)) });
  const loadingText = document.querySelector('#loading .loading-text');
  if (loadingText) loadingText.textContent = `$ ${trans().initializing}`;
  await initConfig();
  const result = await http.get('/api/config', { autoRedirect: false });
  if (result.error || !result.data) {
    const loading = document.getElementById('loading');
    if (loading) loading.textContent = trans().controllerUnavailable;
    return;
  }
  const config = result.data;
  updateAdminAccess(config);
  if (!config.authorization) clearAuthToken();
  VERSION.value = config.version || '';
  LAST_AGENT_VERSION.value = config.last_agent_version || '';
  applyDefaultTheme(config.preferred_theme);
  applyDefaultLanguage(config.default_language);
  const app = createApp(App);
  app.provide('appConfig', config);
  app.use(router);
  app.mount('#app').$nextTick(() => document.getElementById('loading')?.remove());
}
initApp();
