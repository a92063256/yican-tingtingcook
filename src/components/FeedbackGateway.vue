<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { ArrowUpRight, Github, LoaderCircle, MessageCircle, RefreshCw } from 'lucide-vue-next'
import Modal from './Modal.vue'
import { canReachGithub, githubIssuesUrl } from '../feedback'

const emit = defineEmits<{ close: [] }>()
const status = ref<'checking' | 'available' | 'unavailable'>('checking')
let check: AbortController | undefined
async function checkConnection() {
  check?.abort()
  const current = new AbortController()
  check = current
  status.value = 'checking'
  const available = await canReachGithub(current.signal)
  if (!current.signal.aborted) status.value = available ? 'available' : 'unavailable'
}
onMounted(checkConnection)
onUnmounted(() => check?.abort())
</script>

<template>
  <Modal title="建议与问题反馈" sheet @close="emit('close')">
    <div class="feedback-gateway" :aria-busy="status === 'checking'">
      <span class="feedback-gateway-icon" aria-hidden="true"><LoaderCircle v-if="status === 'checking'" class="feedback-spinner" :size="30"/><Github v-else-if="status === 'available'" :size="30"/><MessageCircle v-else :size="30"/></span>
      <div class="feedback-gateway-status" role="status" aria-live="polite">
        <template v-if="status === 'checking'"><h3>正在检查 GitHub 连接</h3><p>请稍等，最多需要 5 秒。</p></template>
        <template v-else-if="status === 'available'"><h3>可以连接 GitHub</h3><p>接下来将跳转到一餐的 GitHub Issues 页面，你可以在那里提建议或反馈问题。</p><small>查看问题无需登录，提交时需要 GitHub 账号。</small></template>
        <template v-else><h3>暂时连接不上 GitHub</h3><p>建议去「抖音评论区」留言，写下你的建议或遇到的问题。</p><small>也可以切换网络后，再试一次。</small></template>
      </div>
      <div v-if="status === 'available'" class="feedback-destination"><Github :size="16"/><span>一餐 · GitHub Issues</span><ArrowUpRight :size="16"/></div>
    </div>
    <template #footer>
      <div class="feedback-gateway-actions">
        <a v-if="status === 'available'" class="btn primary full" :href="githubIssuesUrl" target="_blank" rel="noopener noreferrer" @click="emit('close')">前往 GitHub<ArrowUpRight :size="17"/></a>
        <button v-else-if="status === 'unavailable'" class="btn secondary full" @click="checkConnection">重新检测<RefreshCw :size="16"/></button>
        <button class="btn full" :class="status === 'unavailable' ? 'primary' : 'secondary'" @click="emit('close')">{{status === 'unavailable' ? '知道了' : '暂不反馈'}}</button>
      </div>
    </template>
  </Modal>
</template>

<style scoped>
.feedback-gateway{text-align:center;padding:24px 20px;color:var(--ink)}
.feedback-gateway-icon{display:grid;place-items:center;width:64px;height:64px;margin:0 auto 20px;border-radius:20px;background:var(--soft-orange);color:var(--orange)}
.feedback-gateway-status h3{font-size:19px;line-height:1.5;margin:0 0 12px}
.feedback-gateway-status p{font-size:14px;line-height:1.9;margin:0;color:var(--muted)}
.feedback-gateway-status small{display:block;font-size:12px;line-height:1.8;color:var(--muted);margin-top:12px}
.feedback-destination{display:flex;align-items:center;justify-content:center;gap:9px;background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:14px 10px;margin-top:22px;font-size:12px;color:var(--muted)}
.feedback-gateway-actions{display:grid;gap:10px;width:100%}
.feedback-gateway-actions .btn{min-height:46px;text-decoration:none}
.feedback-spinner{animation:feedback-spin 1s linear infinite}
@keyframes feedback-spin{to{transform:rotate(360deg)}}
@media(prefers-reduced-motion:reduce){.feedback-spinner{animation:none}}
</style>
