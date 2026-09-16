<template>
  <footer class="footer status-bar">
    <span>Server Monitor V{{ VERSION }}</span>
    <span>{{ trans.ipGeolocationBy }} <a href="https://db-ip.com" target="_blank" rel="noopener">DB-IP</a></span>
    <span>{{ trans.basedOn }} <a href="https://github.com/huilang-me/CF-Server-Monitor" target="_blank" rel="noopener">CF-Server-Monitor</a></span>
  </footer>
</template>
<script setup>
import { VERSION } from '../utils/api'
import { useTranslation } from '../utils/i18n'
const trans = useTranslation()
</script>
