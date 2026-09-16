export const SUPPORTED_LANGUAGES = Object.freeze(['en', 'zh', 'ja']);

export function normalizeLanguagePreference(value, fallback = 'auto') {
  const language = String(value || '').trim().toLowerCase();
  if (language === 'auto' || SUPPORTED_LANGUAGES.includes(language)) return language;
  return SUPPORTED_LANGUAGES.includes(fallback) ? fallback : 'auto';
}

export function isChineseBrowserLanguage(value) {
  return /^(zh|cmn|yue|wuu)(-|$)/.test(String(value || '').trim().toLowerCase().replaceAll('_', '-'));
}

export function resolveBrowserLanguage(languages = []) {
  for (const value of languages) {
    const language = String(value || '').trim().toLowerCase().replaceAll('_', '-');
    if (isChineseBrowserLanguage(language)) return 'zh';
    if (/^ja(-|$)/.test(language)) return 'ja';
    if (/^en(-|$)/.test(language)) return 'en';
  }
  return 'en';
}
