<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { CookingPot, RotateCcw } from 'lucide-vue-next'
import App from './App.vue'
import AuthScreen from './components/AuthScreen.vue'
import InviteLanding from './components/InviteLanding.vue'
import { account,accountExpired,accountRequest } from './account'
import { bootstrap } from './shared'

const loading=ref(true),ready=ref(false),error=ref(''),firstAccount=ref(false),legacySlots=ref({chef:false,diner:false})
const inviteId=ref(new URLSearchParams(location.hash.slice(1)).get('invite')??'')
async function load(){
  loading.value=true;error.value='';ready.value=false
  try {
    const result=await accountRequest<{user:typeof account.value;firstAccount:boolean;legacySlots:typeof legacySlots.value}>('/api/auth/me')
    account.value=result.user;firstAccount.value=result.firstAccount;legacySlots.value=result.legacySlots
    if(account.value){await bootstrap();ready.value=true}
  }catch(e){error.value=(e as Error).message}finally{loading.value=false}
}
async function authenticated(){accountExpired.value=false;await load()}
async function joined(){inviteId.value='';history.replaceState(null,'',location.pathname+location.search);await load()}
function later(){inviteId.value='';history.replaceState(null,'',location.pathname+location.search)}
function checkHash(){inviteId.value=new URLSearchParams(location.hash.slice(1)).get('invite')??''}
watch(accountExpired,expired=>{if(expired){ready.value=false;account.value=null;void load()}})
onMounted(()=>{void load();window.addEventListener('hashchange',checkHash)})
onUnmounted(()=>window.removeEventListener('hashchange',checkHash))
</script>
<template>
  <div v-if="loading||error" class="account-loading"><span class="auth-brand-symbol"><CookingPot :size="30"/></span><h1>一餐</h1><p role="status">{{error||'把厨房准备好，等你入座…'}}</p><button v-if="error" class="btn primary" @click="load"><RotateCcw :size="16"/>重新连接</button></div>
  <AuthScreen v-else-if="!account" :first-account="firstAccount" :legacy-slots="legacySlots" :invite-id="inviteId" @authenticated="authenticated"/>
  <InviteLanding v-else-if="inviteId&&ready" :key="inviteId" :invite-id="inviteId" @joined="joined" @later="later"/>
  <App v-else-if="ready"/>
</template>
