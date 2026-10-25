<script setup lang="ts">
import { onMounted,ref } from 'vue'
import { ArrowRight,ChefHat,House,LogOut,Users,Utensils } from 'lucide-vue-next'
import { account,accountRequest,logout,type Invitation } from '../account'
import { newId } from '../shared'
import type { JoinRole } from '../domain'
const props=defineProps<{inviteId:string}>()
const emit=defineEmits<{joined:[];later:[]}>()
const invite=ref<Invitation|null>(null),error=ref(''),busy=ref(false),role=ref<JoinRole>('guest')
onMounted(async()=>{try{const value=await accountRequest<Invitation>('/api/invites/'+encodeURIComponent(props.inviteId));invite.value=value;role.value=value.type==='temporary'?'guest':account.value?.preferredRole==='chef'&&value.chefAvailable?'chef':value.dinerAvailable?'diner':'guest'}catch(e){error.value=(e as Error).message}})
async function join(){busy.value=true;error.value='';try{await accountRequest('/api/commands',{requestId:newId(),command:{type:'invite.join',inviteId:props.inviteId,role:role.value}});emit('joined')}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
async function signout(){try{await logout()}catch(e){error.value=(e as Error).message}}
</script>
<template>
  <main class="invite-landing"><section class="invite-landing-card"><span class="auth-brand-symbol"><House :size="30" :stroke-width="1.5"/></span><span class="eyebrow">A PLACE RESERVED FOR YOU</span><h1>{{invite?.kitchenName??'有一份邀请，等你入座。'}}</h1><p class="auth-subtitle">{{invite?.type==='temporary'?'这一餐相聚，把期待带来就好。':'以后的日子，也一起好好吃饭。'}}</p><p class="invite-account">以 <b>{{account?.nickname}}</b> 的身份加入<button class="text-button" :disabled="busy" @click="signout"><LogOut :size="13"/>换个账号</button></p>
    <template v-if="invite"><p v-if="invite.type==='temporary'" class="invite-meal-date">{{invite.mealDate}} · {{invite.mealName}}<small>仅本餐可点菜，用餐结束后自动失效。</small></p><div v-else class="invite-role-list" role="group" aria-label="选择加入厨房的身份"><button :disabled="!invite.chefAvailable||busy" :class="{selected:role==='chef'}" :aria-pressed="role==='chef'" @click="role='chef'"><ChefHat :size="23"/><span><b>主厨 · 我来掌勺</b><small>{{invite.chefAvailable?'负责菜单与备菜，一个厨房一位主厨':'已有主厨，位置已有人啦'}}</small></span></button><button :disabled="!invite.dinerAvailable||busy" :class="{selected:role==='diner'}" :aria-pressed="role==='diner'" @click="role='diner'"><Utensils :size="23"/><span><b>点菜主人 · 一起经营</b><small>{{invite.dinerAvailable?'管理厨房与邀请，一个厨房一位':'已有点菜主人，可以作为客人加入'}}</small></span></button><button :disabled="busy" :class="{selected:role==='guest'}" :aria-pressed="role==='guest'" @click="role='guest'"><Users :size="23"/><span><b>客人 · 一起吃饭</b><small>自由点菜与评价，不占主人名额</small></span></button></div></template>
    <p v-if="error" class="auth-error" role="alert">{{error}}</p><button v-if="invite" class="btn primary full auth-submit" :disabled="busy" @click="join">{{busy?'正在入座…':'接受邀请，入座'}}<ArrowRight :size="18"/></button><button class="text-button invite-later" :disabled="busy" @click="emit('later')">先回我的厨房</button>
  </section></main>
</template>
