<template>
  <Dialog :open="open" @update:open="value => !value && !busy && $emit('close')">
    <DialogContent :class="cn('modal-dialog dream-dialog', contentClass)" :show-close-button="false" :aria-describedby="undefined" @escape-key-down="guardClose" @pointer-down-outside="guardClose" @close-auto-focus="restoreFocus">
      <DialogTitle class="sr-only">{{ title }}</DialogTitle>
      <slot />
    </DialogContent>
  </Dialog>
</template>

<script setup>
import { watch } from 'vue'
import { Dialog, DialogContent, DialogTitle } from './ui/dialog'
import { cn } from '../lib/utils'
const props = defineProps({ open: Boolean, busy: Boolean, title: { type: String, required: true }, contentClass: String })
defineEmits(['close'])
let opener
watch(() => props.open, open => { if (open) opener = document.activeElement }, { flush: 'sync', immediate: true })
const guardClose = event => { if (props.busy) event.preventDefault() }
const restoreFocus = event => {
  if (opener?.isConnected) { event.preventDefault(); opener.focus({ preventScroll: true }) }
}
</script>
