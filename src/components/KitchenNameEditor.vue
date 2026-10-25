<script setup lang="ts">
import { computed, ref } from 'vue'
import { Check, House, Users } from 'lucide-vue-next'
import Modal from './Modal.vue'

const props=defineProps<{name:string;save:(name:string,previous:string)=>Promise<void>}>()
const emit=defineEmits<{close:[]}>()
const original=ref(props.name),draft=ref(props.name),saving=ref(false),error=ref('')
const name=computed(()=>draft.value.trim())
const changedElsewhere=computed(()=>props.name!==original.value)
const canSave=computed(()=>!!name.value&&name.value.length<=18&&name.value!==original.value&&!saving.value&&!changedElsewhere.value)
function useLatest(){original.value=props.name;draft.value=props.name;error.value=''}
async function submit(){
  if(!canSave.value)return
  saving.value=true;error.value=''
  try{await props.save(name.value,original.value);emit('close')}
  catch(e){error.value=(e as Error).message}
  finally{saving.value=false}
}
</script>

<template>
  <Modal title="修改厨房名称" sheet @close="!saving&&emit('close')">
    <form id="kitchen-name-form" class="kitchen-name-form" @submit.prevent="submit">
      <div class="kitchen-name-preview"><span class="kitchen-name-icon"><House :size="24"/></span><div><small>我们的厨房</small><strong>{{name||'给厨房起个喜欢的名字'}}</strong></div></div>
      <label class="form-field" for="kitchen-name-input">厨房名称
        <input id="kitchen-name-input" v-model="draft" maxlength="18" required :disabled="saving" placeholder="例如：小川和小禾的小厨房" autocomplete="off" aria-describedby="kitchen-name-hint">
      </label>
      <div id="kitchen-name-hint" class="kitchen-name-hint"><span>给一起吃饭的日子，起个名字。</span><span>{{draft.length}} / 18</span></div>
      <p class="kitchen-name-sharing"><Users :size="16"/><span>主厨和点菜主人都可以修改，保存后全厨房同步更新。</span></p>
      <div v-if="changedElsewhere" class="kitchen-name-conflict" role="status"><p>家人刚刚把名字改成了「{{props.name}}」。请先查看最新名字，再继续修改。</p><button type="button" class="text-button" :disabled="saving" @click="useLatest">使用最新名字</button></div>
      <p v-else-if="error" class="kitchen-name-error" role="alert">{{error}}</p>
    </form>
    <template #footer><div class="kitchen-name-actions"><button class="btn secondary" type="button" :disabled="saving" @click="emit('close')">取消</button><button class="btn primary" type="submit" form="kitchen-name-form" :disabled="!canSave"><Check :size="17"/>{{saving?'正在保存…':'保存名字'}}</button></div></template>
  </Modal>
</template>

<style scoped>
.kitchen-name-form{padding:20px}
.kitchen-name-preview{display:flex;align-items:center;gap:14px;padding:20px 16px;background:var(--soft-orange);border:1px solid var(--line);border-radius:16px;margin-bottom:24px}
.kitchen-name-icon{display:grid;place-items:center;flex:0 0 48px;height:48px;background:var(--white);border-radius:14px;color:var(--orange)}
.kitchen-name-preview>div{min-width:0}.kitchen-name-preview small{display:block;font-size:11px;color:var(--muted);margin-bottom:7px}.kitchen-name-preview strong{display:block;font-size:19px;line-height:1.5;color:var(--ink);overflow-wrap:anywhere}
.kitchen-name-form .form-field{margin-bottom:8px}.kitchen-name-form input{min-height:48px}
.kitchen-name-hint{display:flex;justify-content:space-between;gap:12px;color:var(--muted);font-size:11px;line-height:1.7}.kitchen-name-hint>span:last-child{white-space:nowrap}
.kitchen-name-sharing{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.8;color:var(--muted);margin:22px 0 4px}.kitchen-name-sharing svg{flex-shrink:0;margin-top:3px}
.kitchen-name-conflict{margin-top:16px;padding:12px;background:#fff5e7;border-radius:10px;font-size:12px;line-height:1.8;color:#835a2f;overflow-wrap:anywhere}.kitchen-name-conflict p{margin:0}.kitchen-name-conflict button{min-height:44px}
.kitchen-name-error{color:#a74535;font-size:12px;line-height:1.8;margin-top:16px}
.kitchen-name-actions{display:grid;grid-template-columns:1fr 2fr;gap:12px}.kitchen-name-actions .btn{min-height:48px}
</style>
