<script setup lang="ts">
import { Check, CookingPot } from 'lucide-vue-next'
import Modal from './Modal.vue'
import { themes, type Theme } from '../themes'
defineProps<{ selected: string }>()
const emit = defineEmits<{ close: []; select: [theme: Theme] }>()
</script>
<template>
  <Modal title="为日常，换一种心情" sheet @close="emit('close')">
    <div class="theme-panel">
    <p class="theme-intro">五种色调，都是好好吃饭的心情。<br>轻点即刻换色，自动记住你的选择。</p>
    <div class="theme-options" role="group" aria-label="选择主题颜色">
      <button v-for="t in themes" :key="t.id" class="theme-option" :class="{selected:selected===t.id}" :aria-pressed="selected===t.id" :aria-label="t.name" :style="{'--preview-paper':t.colors.paper,'--preview-tint':t.colors.tint,'--preview-accent':t.colors.accent,'--preview-companion':t.colors.companion}" @click="emit('select',t)">
        <span class="theme-preview" aria-hidden="true"><span class="theme-preview-window"><CookingPot :size="20"/><i></i><i></i><b></b></span><span class="theme-swatches"><i></i><i></i><i></i></span></span>
        <span class="theme-option-copy"><b>{{t.name}}</b><small>{{t.description}}</small></span>
        <span class="theme-check" :class="{checked:selected===t.id}"><Check v-if="selected===t.id" :size="16"/><span class="sr-only">{{selected===t.id?'使用中':'选择'}}</span></span>
      </button>
    </div>
    <p class="theme-footnote">外观偏好保存在当前浏览器，你的饭搭子可以选择自己的颜色。</p>
    </div>
    <template #footer><button class="btn primary full" @click="emit('close')">选好了<Check :size="17"/></button></template>
  </Modal>
</template>
