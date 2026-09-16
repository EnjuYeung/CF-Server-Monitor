<template>
  <section class="two-factor-panel" aria-labelledby="two-factor-title">
    <h3 id="two-factor-title">{{ trans.twoFactorTitle }}</h3>
    <p>{{ trans.twoFactorDescription }}</p>
    <p v-if="loaded"><strong>{{ enabled ? trans.twoFactorEnabled : trans.twoFactorDisabled }}</strong><span v-if="enabled"> · {{ trans.recoveryCodesRemaining.replace('{count}', remaining) }}</span></p>

    <div v-if="recoveryCodes.length" class="two-factor-recovery">
      <h4>{{ trans.twoFactorRecoveryTitle }}</h4>
      <p>{{ trans.twoFactorRecoveryHint }}</p>
      <textarea class="form-textarea" readonly :value="recoveryCodes.join('\n')" rows="10" :aria-label="trans.twoFactorRecoveryTitle"></textarea>
      <button class="btn btn-primary" type="button" @click="recoveryCodes = []">{{ trans.recoveryCodesSaved }}</button>
    </div>

    <form v-else-if="loaded" @submit.prevent="submit">
      <div class="form-group">
        <label for="two-factor-password" class="form-label">{{ trans.currentPassword }}</label>
        <input id="two-factor-password" v-model="password" type="password" autocomplete="current-password" required class="form-input" :disabled="busy">
      </div>
      <div v-if="setup" class="two-factor-setup">
        <p>{{ trans.twoFactorScan }}</p>
        <img :src="setup.qrCode" width="256" height="256" :alt="trans.twoFactorScan" class="two-factor-qr">
        <label for="two-factor-secret" class="form-label">{{ trans.twoFactorManualKey }}</label>
        <input id="two-factor-secret" class="form-input" :value="setup.secret" readonly autocomplete="off" spellcheck="false">
        <p>{{ trans.twoFactorSetupExpires }}</p>
      </div>
      <div v-if="setup || enabled" class="form-group">
        <label for="two-factor-code" class="form-label">{{ useRecovery ? trans.recoveryCode : trans.twoFactorCode }}</label>
        <input id="two-factor-code" v-model="code" class="form-input" type="text" :inputmode="useRecovery ? 'text' : 'numeric'" :pattern="useRecovery ? undefined : '[0-9]{6}'" :maxlength="useRecovery ? 23 : 6" autocomplete="one-time-code" required :disabled="busy">
        <button v-if="enabled" type="button" class="btn btn-sm" :disabled="busy" @click="useRecovery = !useRecovery; code = ''">{{ useRecovery ? trans.useAuthenticator : trans.useRecoveryCode }}</button>
      </div>
      <div class="two-factor-actions">
        <button type="submit" :class="['btn', enabled ? 'btn-red' : 'btn-primary']" :disabled="busy">{{ busy ? trans.loading : enabled ? trans.disableTwoFactor : setup ? trans.confirmTwoFactor : trans.setupTwoFactor }}</button>
        <button v-if="setup" type="button" class="btn" :disabled="busy" @click="resetSetup">{{ trans.cancel }}</button>
      </div>
    </form>
    <p v-if="error" class="text-danger" role="alert">{{ error }}</p>
    <p v-if="message" role="status">{{ message }}</p>
  </section>
</template>

<script setup>
import { ref, watch } from 'vue'
import { http, setAuthToken } from '../../../utils/http'
import { adminEndpoint } from '../../../utils/adminAccess.js'

const props = defineProps({ trans: {type: Object, required: true}, baseUrl: {type: String, required: true} })
const enabled = ref(false), remaining = ref(0), loaded = ref(false), busy = ref(false)
const setup = ref(null), password = ref(''), code = ref(''), useRecovery = ref(false)
const recoveryCodes = ref([]), error = ref(''), message = ref('')
const request = data => http.post(adminEndpoint('/api'), data, {baseUrl: props.baseUrl})
const resetSetup = () => { setup.value = null; password.value = ''; code.value = ''; error.value = '' }
const displayError = result => props.trans[result.error] || props.trans.securityRequestFailed

watch(() => props.baseUrl, async () => {
  resetSetup(); loaded.value = false; recoveryCodes.value = []; message.value = ''
  const result = await request({ action: 'two_factor_status' })
  if (result.error) { error.value = displayError(result); return }
  enabled.value = result.data.enabled; remaining.value = result.data.recoveryCodesRemaining; loaded.value = true
}, {immediate: true})

async function submit() {
  if (busy.value) return
  busy.value = true; error.value = ''; message.value = ''
  try {
    const action = enabled.value ? 'two_factor_disable' : setup.value ? 'two_factor_enable' : 'two_factor_setup'
    const result = await request({action, password: password.value, ...(useRecovery.value ? {recoveryCode: code.value} : {otp: code.value})})
    if (result.error) { error.value = displayError(result); code.value = ''; return }
    if (action === 'two_factor_setup') { setup.value = result.data; return }
    setAuthToken(result.data.token, props.baseUrl)
    enabled.value = result.data.enabled; remaining.value = result.data.recoveryCodesRemaining
    recoveryCodes.value = result.data.recoveryCodes || []
    resetSetup(); useRecovery.value = false
    if (!enabled.value) message.value = props.trans.twoFactorDisabledSuccess
  } finally { busy.value = false }
}
</script>

<style scoped>
.two-factor-panel { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-color); min-width: 0; }
.two-factor-panel p { line-height: 1.65; margin: 12px 0; overflow-wrap: anywhere; }
.two-factor-qr { display: block; max-width: 100%; height: auto; margin: 16px 0; border-radius: 8px; }
.two-factor-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.two-factor-recovery textarea { font-family: monospace; margin-bottom: 12px; }
</style>
