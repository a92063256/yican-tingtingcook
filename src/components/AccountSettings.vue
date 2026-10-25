<script setup lang="ts">
import { computed,ref } from 'vue'
import { Check,ChevronRight,House,KeyRound,LogOut,ShieldCheck,UserRound } from 'lucide-vue-next'
import Modal from './Modal.vue'
import { account,accountRequest,logout } from '../account'
defineProps<{hasKitchen?:boolean}>()
const emit=defineEmits<{close:[];manage:[]}>()
const passwordless=ref(account.value?.passwordless??false),currentPassword=ref(''),newPassword=ref(''),confirmation=ref(''),busy=ref(false),error=ref(''),success=ref('')
const needsCurrent=computed(()=>!account.value?.passwordless)
async function save(){
  error.value='';success.value=''
  if(!passwordless.value&&newPassword.value!==confirmation.value){error.value='两次输入的新密码不一致';return}
  if(busy.value)return;busy.value=true
  try{const value=await accountRequest<{user:NonNullable<typeof account.value>}>('/api/auth/security',{passwordless:passwordless.value,currentPassword:currentPassword.value,newPassword:newPassword.value});account.value=value.user;currentPassword.value='';newPassword.value='';confirmation.value='';success.value=passwordless.value?'已开启免密码模式，其他设备需重新登录。':'密码已保存，其他设备需使用新密码登录。'}catch(e){error.value=(e as Error).message}finally{busy.value=false}
}
async function signout(){error.value='';busy.value=true;try{await logout()}catch(e){error.value=(e as Error).message}finally{busy.value=false}}
</script>
<template>
  <Modal title="我的账号" sheet @close="!busy&&emit('close')">
    <form id="account-security" class="account-settings-panel" @submit.prevent="save">
      <div class="account-summary"><span><UserRound :size="25"/></span><div><h3>{{account?.nickname}}</h3><p>{{account?.username}}</p></div><span class="badge soft">{{account?.passwordless?'免密码账号':'密码保护'}}</span></div>
      <button v-if="hasKitchen" type="button" class="setting-row clickable full" :disabled="busy" @click="emit('manage')"><House :size="19"/><span>厨房与成员管理<small>成员、邀请与退出厨房</small></span><ChevronRight :size="18"/></button>
      <div class="account-security-title"><ShieldCheck :size="18"/><h3>登录与密码</h3></div>
      <fieldset class="auth-fields" :disabled="busy"><button type="button" class="auth-passwordless" :class="{selected:passwordless}" :aria-pressed="passwordless" @click="passwordless=!passwordless;success='' "><span class="auth-toggle-check"><Check v-if="passwordless" :size="14"/></span><KeyRound :size="17"/><span>免密码登录</span></button><p v-if="passwordless" class="auth-mode-note">开启后，知道你的账号或昵称的人都能登录。仅在信任的家人朋友之间使用。</p><p v-else class="auth-mode-note">设置密码后，必须输入密码才能进入；免密码入口将不能登录此账号。</p><label v-if="needsCurrent" class="form-field">当前密码<input v-model="currentPassword" type="password" required autocomplete="current-password" maxlength="128" placeholder="先确认是你本人"></label><template v-if="!passwordless"><label class="form-field">{{account?.passwordless?'设置密码':'新密码'}}<input v-model="newPassword" type="password" required minlength="6" maxlength="128" autocomplete="new-password" placeholder="至少 6 位"></label><label class="form-field">确认新密码<input v-model="confirmation" type="password" required minlength="6" maxlength="128" autocomplete="new-password" placeholder="再输入一次新密码"></label></template><p v-if="error" class="auth-error" role="alert">{{error}}</p><p v-if="success" class="account-success" role="status"><Check :size="17"/>{{success}}</p></fieldset>
      <button type="button" class="account-logout" :disabled="busy" @click="signout"><LogOut :size="17"/>退出当前账号</button>
    </form>
    <template #footer><button class="btn primary full" form="account-security" type="submit" :disabled="busy">{{busy?'正在保存…':'保存登录设置'}}<Check :size="17"/></button></template>
  </Modal>
</template>
