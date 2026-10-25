<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft, ArrowRightLeft, Check, ChevronRight, House, Link, LogOut, ShieldCheck, Trash2, Users } from 'lucide-vue-next'
import Modal from './Modal.vue'
import { dinerOwner, isKitchenHost, type State } from '../domain'
import { fingerprint, sharedBusy } from '../shared'
import type { Command } from '../../server/commands'

const props=defineProps<{state:State;kitchenId:string;person:string;now:number;send:(c:Command)=>Promise<boolean>}>()
const emit=defineEmits<{close:[];left:[];invite:[]}>()
const section=ref('home'),confirmation=ref<Command|null>(null),confirmationText=ref(''),typedName=ref(''),target=ref(''),error=ref('')
const kitchen=computed(()=>props.state.kitchens.find(k=>k.id===props.kitchenId)!)
const host=computed(()=>!!kitchen.value&&isKitchenHost(props.state,props.person,kitchen.value))
const members=computed(()=>props.state.members.filter(m=>m.kitchenId===props.kitchenId))
const temporary=computed(()=>[...new Set(props.state.grants.filter(g=>!g.revoked&&props.state.meals.some(m=>m.id===g.mealId&&m.kitchenId===props.kitchenId&&m.status!=='cancelled'&&props.now<+new Date(m.endsAt))).map(g=>g.userId))].filter(id=>!members.value.some(m=>m.userId===id)))
const candidates=computed(()=>members.value.filter(m=>m.userId!==props.person&&m.userId!==kitchen.value.chefId&&m.userId!==dinerOwner(props.state,kitchen.value)))
const invites=computed(()=>props.state.invites.filter(i=>i.kitchenId===props.kitchenId&&!i.revoked&&props.now<+new Date(i.expiresAt)&&(i.type==='long'||props.state.meals.some(m=>m.id===i.mealId&&m.status==='open'&&props.now<+new Date(m.deadline)&&props.now<+new Date(m.endsAt)))))
const personName=(id:string)=>props.state.people?.[id]?.name??'家人'
const owner=(id:string)=>id===kitchen.value.chefId||id===dinerOwner(props.state,kitchen.value)
const myRole=computed(()=>kitchen.value.chefId===props.person?'chef':'diner')
const title=computed(()=>confirmation.value?'确认这次操作':({home:'厨房与成员',members:'一起吃饭的人',invites:'邀请管理',transfer:'交接主人身份',dissolve:'解散厨房'} as Record<string,string>)[section.value])
function ask(c:Command,text:string){confirmation.value=c;confirmationText.value=text;error.value=''}
function back(){confirmation.value=null;section.value='home';error.value='';typedName.value='';target.value=''}
async function execute(c:Command){
  error.value=''
  const ok=await props.send(c)
  if(!ok){error.value='操作未完成，请查看提示后重试。';return}
  confirmation.value=null
  if(c.type==='kitchen.leave'||c.type==='kitchen.dissolve')emit('left')
  else if(c.type==='kitchen.transfer'){back();emit('close')}
}
</script>
<template>
  <Modal :title="title" sheet @close="!sharedBusy&&emit('close')">
    <div v-if="kitchen" class="management-panel">
      <button v-if="section!=='home'||confirmation" class="text-button management-back" :disabled="sharedBusy" @click="confirmation?confirmation=null:back()"><ArrowLeft :size="16"/>返回{{confirmation?'上一页':'厨房管理'}}</button>
      <template v-if="confirmation">
        <div class="management-hero caution"><ShieldCheck :size="28"/><h3>请确认后再继续</h3><p>{{confirmationText}}</p></div>
        <div class="management-actions"><button class="btn secondary" :disabled="sharedBusy" @click="confirmation=null">再想一下</button><button class="btn primary" :disabled="sharedBusy" @click="execute(confirmation!)">{{sharedBusy?'正在保存…':'确认操作'}}<Check :size="17"/></button></div>
      </template>
      <template v-else-if="section==='home'">
        <div class="management-hero"><House :size="28"/><span class="eyebrow">OUR LITTLE KITCHEN</span><h3>{{kitchen.name}}</h3><p>照料好厨房，也照顾每一次相聚。</p></div>
        <button class="setting-row clickable" @click="section='members'"><span>成员管理<b>{{members.length}} 位长期成员<span v-if="temporary.length"> · {{temporary.length}} 位单餐客人</span></b><small>{{host?'查看成员、移除客人':'看看一起吃饭的人'}}</small></span><Users :size="20"/></button>
        <button v-if="host" class="setting-row clickable" @click="section='invites'"><span>邀请管理<b>{{invites.length}} 个有效邀请</b><small>创建新邀请，或撤销旧链接</small></span><Link :size="20"/></button>
        <button v-if="host" class="setting-row clickable" @click="section='transfer'"><span>交接我的主人身份<b>{{myRole==='chef'?'主厨':'点菜主人'}}</b><small>交给一位长期客人，交接后可退出</small></span><ArrowRightLeft :size="20"/></button>
        <div class="management-danger"><button v-if="!host" class="setting-row clickable" @click="ask({type:'kitchen.leave',kitchenId},'退出后将无法查看这个厨房的菜单和历史。原有点菜与评价保留；重新加入需要有效邀请。')"><span>退出这个厨房<small>账号和其他厨房不受影响</small></span><LogOut :size="19"/></button><template v-else><p class="small-note">主人需先交接身份才能退出。若不再使用这个厨房，可以解散。</p><button class="setting-row clickable" @click="section='dissolve'"><span>解散厨房<small>所有成员和邀请立即停止访问</small></span><Trash2 :size="19"/></button></template></div>
      </template>
      <template v-else-if="section==='members'">
        <p class="small-note">{{host?'两位主人可移除客人；主人身份须由本人交接。移除不会删除账号或历史点菜。':'成员身份仅由厨房主人管理。'}}</p>
        <div v-for="m in members" :key="m.userId" class="management-member"><span class="avatar small" :style="{background:state.people?.[m.userId]?.color}">{{state.people?.[m.userId]?.short??'家'}}</span><div><b>{{personName(m.userId)}}{{m.userId===person?'（我）':''}}</b><small>{{m.userId===kitchen.chefId?kitchen.chefLabel:m.userId===dinerOwner(state,kitchen)?'点菜主人':'长期客人'}}</small></div><button v-if="host&&!owner(m.userId)&&m.userId!==person" class="text-button danger-text" :aria-label="'移除'+personName(m.userId)" @click="ask({type:'member.remove',kitchenId,userId:m.userId},`移除「${personName(m.userId)}」后，该成员将失去本厨房的访问权限。有效邀请仍能用于再次加入，可在邀请管理中撤销。`)">移除</button></div>
        <div v-for="id in temporary" :key="id" class="management-member"><span class="avatar small">{{state.people?.[id]?.short??'客'}}</span><div><b>{{personName(id)}}</b><small>单餐客人 · 用餐结束后到期</small></div><button v-if="host&&id!==person" class="text-button danger-text" @click="ask({type:'member.remove',kitchenId,userId:id},`移除单餐客人「${personName(id)}」，立即撤销本厨房的用餐权限。历史点菜仍保留。`)">移除</button></div>
      </template>
      <template v-else-if="section==='invites'">
        <p class="small-note">撤销后，旧链接不能再加入厨房；已经加入的成员不受影响，可在成员管理中移除。</p>
        <article v-for="i in invites" :key="i.id" class="management-invite"><div><span class="badge soft">{{i.type==='long'?'长期邀请':'单餐邀请'}}</span><p>{{i.type==='temporary'?state.meals.find(m=>m.id===i.mealId)?.name:'加入我们的小厨房'}}</p><small>{{new Date(i.expiresAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}} 到期</small></div><button class="text-button danger-text" :disabled="sharedBusy" @click="ask({type:'invite.revoke',inviteId:i.id},'撤销这个邀请链接？链接将立即失效，已加入的成员不会被移除。')">撤销</button></article>
        <p v-if="!invites.length" class="empty-small">还没有有效邀请，给下一位饭搭子留个位置。</p><button class="btn secondary full" @click="emit('invite')"><Users :size="17"/>创建新邀请</button>
      </template>
      <template v-else-if="section==='transfer'">
        <div class="management-hero"><ArrowRightLeft :size="28"/><h3>把厨房放心交给 TA</h3><p>交接后，你将成为长期客人。新主人会获得{{myRole==='chef'?'菜单、餐次、库存及成员':'厨房信息、邀请及成员'}}管理权限。</p></div>
        <label class="form-field">接任成员<select v-model="target"><option value="" disabled>选择一位长期客人</option><option v-for="m in candidates" :key="m.userId" :value="m.userId">{{personName(m.userId)}}</option></select></label><p v-if="!candidates.length" class="inline-info">还没有可交接的长期客人。请先邀请对方加入厨房。</p><button class="btn primary full" :disabled="!target||sharedBusy" @click="ask({type:'kitchen.transfer',kitchenId,userId:target,role:myRole},`将${myRole==='chef'?'主厨':'点菜主人'}身份交给「${personName(target)}」？交接立即生效，后续需要由新主人交还。`)">确认接任人<ChevronRight :size="17"/></button>
      </template>
      <template v-else-if="section==='dissolve'">
        <div class="management-hero caution"><Trash2 :size="28"/><h3>为这个厨房画上句号</h3><p>所有成员将立即失去访问权限，邀请同时失效。历史数据封存于本机数据库，当前不提供恢复入口。你的账号和其他厨房不受影响。</p></div><label class="form-field">输入厨房名称「{{kitchen.name}}」确认<input v-model="typedName" autocomplete="off" placeholder="完整的厨房名称"></label><button class="btn primary full danger-fill" :disabled="typedName!==kitchen.name||sharedBusy" @click="ask({type:'kitchen.dissolve',kitchenId,name:typedName,expected:fingerprint(kitchen)},'最后确认：解散后所有成员都无法继续使用这个厨房，页面不提供撤销。')">解散这个厨房<Trash2 :size="17"/></button>
      </template>
      <p v-if="error" class="auth-error" role="alert">{{error}}</p>
    </div>
  </Modal>
</template>
<style scoped>
.management-panel{padding:20px 22px 28px}.management-back{min-height:40px;margin-bottom:12px}.management-hero{display:flex;flex-direction:column;align-items:flex-start;gap:10px;padding:24px;border-radius:20px;background:var(--paper);margin-bottom:20px;overflow-wrap:anywhere}.management-hero>svg{color:var(--orange)}.management-hero h3{margin:0;font-size:22px}.management-hero p{margin:0;font-size:14px;line-height:1.8;color:var(--muted)}.management-hero .eyebrow{font-size:10px;letter-spacing:2px}.management-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px}.management-danger{margin-top:24px;padding-top:14px;border-top:1px dashed var(--line)}.management-danger .setting-row,.danger-text{color:#a23e35}.danger-fill{background:#a23e35}.management-member{display:flex;align-items:center;gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}.management-member>div{flex:1;min-width:0;overflow-wrap:anywhere}.management-member small{display:block;margin-top:5px;color:var(--muted);font-size:12px}.management-member button,.management-invite button{min-height:44px;flex-shrink:0}.management-invite{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 0;border-bottom:1px solid var(--line)}.management-invite p{margin:10px 0 6px}.management-invite small{color:var(--muted)}.management-invite:last-of-type{margin-bottom:20px}.caution{background:#fbf1ec}.caution>svg{color:#a23e35}.setting-row{width:100%;text-align:left}.setting-row>span{min-width:0;overflow-wrap:anywhere}.setting-row>svg{flex-shrink:0}
</style>
