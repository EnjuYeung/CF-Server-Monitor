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
import { getMikusAssetUrl, isMikusThemeEnabled, setMikusThemeClass } from './utils/themeOptions'
import { applyDefaultTheme } from './composables/useTheme'
const getTranslation = () => {
  const lang = currentLang.value || resolveLanguagePreference(localStorage.getItem('language_preference') || 'auto')
  return translations[lang] || translations.en
}

const trans = () => getTranslation()

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
}[char]))

const renderMikusStartupLoading = (siteTitle) => {
  const loading = document.getElementById('loading')
  if (!loading || loading.dataset.mikusRendered === '1') return

  const title = escapeHtml(String(siteTitle || 'Komari').trim() || 'Komari')
  const loliUrl = getMikusAssetUrl('loli.gif')
  const logoUrl = getMikusAssetUrl('miku.png')
  const petals = Array.from({ length: 18 }, () => '<span class="mikus-background-petal"></span>').join('')
  loading.dataset.mikusRendered = '1'
  loading.classList.add('mikus-startup')
  loading.innerHTML = `
    <div class="mikus-sakura-background mikus-startup-sakura" aria-hidden="true">${petals}</div>
    <div class="mikus-startup-loading">
      <img class="mikus-startup-gif" src="${loliUrl}" alt="Loading">
      <div class="mikus-startup-brand">
        <img class="mikus-startup-logo" src="${logoUrl}" alt="">
        <span>${title}</span>
      </div>
      <div class="mikus-startup-progress" aria-hidden="true">
        <div class="mikus-startup-progress-fill"></div>
      </div>
      <div class="mikus-startup-status">$ ${escapeHtml(trans().initializing)}</div>
    </div>
  `
}

const applyStartupThemeOptions = (config) => {
  const enabled = isMikusThemeEnabled(config?.theme_options)
  setMikusThemeClass(enabled)
  if (enabled) {
    renderMikusStartupLoading(config?.site_title)
  }
}

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
  applyStartupThemeOptions(config);
  const app = createApp(App);
  app.provide('appConfig', config);
  app.use(router);
  app.mount('#app').$nextTick(() => document.getElementById('loading')?.remove());
}
initApp();
