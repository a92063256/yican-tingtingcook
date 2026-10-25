<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { X } from 'lucide-vue-next'
defineProps<{ title: string; wide?: boolean; sheet?: boolean }>()
const emit = defineEmits<{close: []}>()
const box = ref<HTMLElement>()
let previous: HTMLElement | null = null
function key(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  if (e.key === 'Tab' && box.value) {
    const nodes = [...box.value.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, a[href]')]
    const first = nodes[0], last = nodes.at(-1)
    if(e.shiftKey && document.activeElement===first) {e.preventDefault();last?.focus()}
    else if(!e.shiftKey && document.activeElement===last) {e.preventDefault();first?.focus()}
  }
}
onMounted(() => { previous = document.activeElement as HTMLElement; document.body.style.overflow='hidden'; box.value?.querySelector<HTMLElement>('button')?.focus(); document.addEventListener('keydown',key) })
onUnmounted(() => { document.body.style.overflow=''; document.removeEventListener('keydown',key); previous?.focus() })
</script>
<template><Teleport to="body"><div class="modal-backdrop" :class="{'sheet-backdrop':sheet}" @click.self="emit('close')"><section ref="box" class="modal" :class="{wide,sheet}" role="dialog" aria-modal="true" :aria-label="title"><header class="modal-head"><h2>{{title}}</h2><button class="icon-btn" aria-label="关闭弹窗" @click="emit('close')"><X :size="21"/></button></header><div class="modal-content"><slot/></div><footer v-if="$slots.footer" class="modal-footer"><slot name="footer"/></footer></section></div></Teleport></template>
