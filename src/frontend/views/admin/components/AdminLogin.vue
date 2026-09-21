<template>
  <div id="login-overlay" class="login-overlay">
    <TerminalHeader :title="trans.adminLogin" />
    <div class="login-container">
      <div class="login-header">
        <div class="login-icon">🔐</div>
        <h1 class="login-title">{{ trans.adminLogin }}</h1>
        <p class="login-subtitle">{{ trans.enterCredentials }}</p>
      </div>
      <form @submit.prevent="$emit('login')">
        <div v-if="isMultipleMode" class="login-form-group">
          <label class="login-label">{{ trans.apiEndpoint }}</label>
          <select :value="selectedApiIndex" class="login-input" @change="$emit('api-index-change', Number($event.target.value))">
            <option
              v-for="(base, index) in apiBases"
              :key="index"
              :value="index"
            >
              [{{ index }}] {{ base }}
            </option>
          </select>
        </div>
        <div class="login-form-group">
          <label class="login-label" for="login-username">{{ trans.username }}</label>
          <input id="login-username" type="text" name="username" autocomplete="username" v-model="loginForm.username" required class="login-input" placeholder="admin" :disabled="loginLoading">
        </div>
        <div class="login-form-group last">
          <label class="login-label" for="login-password">{{ trans.password }}</label>
          <div class="password-input-wrapper">
            <input id="login-password" :type="passwordVisible.login ? 'text' : 'password'" name="password" autocomplete="current-password" v-model="loginForm.password" required class="login-input" placeholder="••••••••" :disabled="loginLoading">
            <button type="button" class="password-toggle" :aria-label="trans.password" :aria-pressed="passwordVisible.login" @click="$emit('toggle-password', 'login')">
              {{ passwordVisible.login ? '🙈' : '👁️' }}
            </button>
          </div>
        </div>
        <div v-if="requiresTwoFactor" class="login-form-group">
          <p>{{ trans.twoFactorLoginPrompt }}</p>
          <label class="login-label" for="login-otp">{{ loginForm.useRecovery ? trans.recoveryCode : trans.twoFactorCode }}</label>
          <input id="login-otp" name="one-time-code" v-model="loginForm.code" type="text" :inputmode="loginForm.useRecovery ? 'text' : 'numeric'" :pattern="loginForm.useRecovery ? undefined : '[0-9]{6}'" :maxlength="loginForm.useRecovery ? 23 : 6" autocomplete="one-time-code" required class="login-input" :disabled="loginLoading">
          <button type="button" class="btn btn-sm" :disabled="loginLoading" @click="loginForm.useRecovery = !loginForm.useRecovery; loginForm.code = ''">{{ loginForm.useRecovery ? trans.useAuthenticator : trans.useRecoveryCode }}</button>
        </div>
        <div v-if="loginError" id="login-error" class="login-error" role="alert">{{ loginError }}</div>
        <Button type="submit" class="login-btn" :disabled="loginLoading" :aria-busy="loginLoading">{{ loginLoading ? '⏳ ' + trans.loading : trans.login }}</Button>
      </form>
    </div>
    <Footer />
  </div>
</template>

<script setup>
import Footer from '../../../components/Footer.vue'
import TerminalHeader from '../../../components/TerminalHeader.vue'
import { Button } from '../../../components/ui/button'

defineProps({
  trans: { type: Object, required: true },
  isMultipleMode: { type: Boolean, default: false },
  apiBases: { type: Array, default: () => [] },
  selectedApiIndex: { type: Number, default: 0 },
  loginForm: { type: Object, required: true },
  passwordVisible: { type: Object, required: true },
  loginError: { type: String, default: '' },
  loginLoading: { type: Boolean, default: false },
  requiresTwoFactor: { type: Boolean, default: false },
})

defineEmits(['login', 'toggle-password', 'api-index-change'])
</script>
