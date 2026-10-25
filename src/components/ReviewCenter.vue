<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { Heart, MessageCircle, Check, ArrowRight } from 'lucide-vue-next'
import Modal from './Modal.vue'
import ReviewFeed from './ReviewFeed.vue'
import { people, type State } from '../domain'
import { canReadMealReviews, canReviewMeal, reviewRecipes, reviewTextLimit } from '../reviews'

const props = defineProps<{ state:State; person:string; now:number; open:boolean; initialMealId:string; initialRecipeId:string|null; busy:boolean; save:(mealId:string,recipeId:string|null,text:string,expected:string|null)=>Promise<boolean> }>()
const emit=defineEmits<{close:[]}>()
const mealId=ref(''), target=ref(''), textarea=ref<HTMLTextAreaElement>()
// Preserve unsaved messages when switching dishes, meals or closing the sheet.
const drafts=reactive<Record<string,{text:string;expected:string|null}>>({})
const success=ref(''), saving=ref(false)
const meals=computed(()=>props.state.meals.filter(m=>canReadMealReviews(props.state,props.person,m)&&
  (canReviewMeal(props.state,props.person,m,props.now)||(props.state.reviews??[]).some(r=>r.mealId===m.id)))
  .sort((a,b)=>b.startsAt.localeCompare(a.startsAt)))
const meal=computed(()=>meals.value.find(m=>m.id===mealId.value))
const dishes=computed(()=>meal.value?reviewRecipes(props.state,meal.value):[])
const own=computed(()=>(props.state.reviews??[]).find(r=>r.mealId===mealId.value&&r.userId===props.person&&r.recipeId===(target.value||null)))
const draftKey=computed(()=>JSON.stringify([props.person,mealId.value,target.value]))
const draft=computed(()=>drafts[draftKey.value])
const changedElsewhere=computed(()=>draft.value&&draft.value.expected!==(own.value?JSON.stringify(own.value):null))
function loadLatest(){delete drafts[draftKey.value];loadDraft()}
const isChef=computed(()=>props.state.kitchens.find(k=>k.id===meal.value?.kitchenId)?.chefId===props.person)
const chefName=computed(()=>people[props.state.kitchens.find(k=>k.id===meal.value?.kitchenId)?.chefId||'']?.name||'主厨')
const allowed=computed(()=>!!meal.value&&canReviewMeal(props.state,props.person,meal.value,props.now))
const feed=computed(()=>(props.state.reviews??[]).filter(r=>r.mealId===mealId.value&&(!target.value||r.recipeId===target.value)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)))
const label=(id:string)=>{const m=props.state.meals.find(m=>m.id===id);return m?`${m.date} · ${m.name} · ${props.state.kitchens.find(k=>k.id===m.kitchenId)?.name}`:''}
function loadDraft(){if(!drafts[draftKey.value])drafts[draftKey.value]={text:own.value?.text||'',expected:own.value?JSON.stringify(own.value):null};success.value=''}
watch(draftKey,loadDraft,{immediate:true})
watch(()=>props.open,open=>{if(open){mealId.value=meals.value.some(m=>m.id===props.initialMealId)?props.initialMealId:meals.value[0]?.id||'';target.value=dishes.value.some(r=>r.id===props.initialRecipeId)?props.initialRecipeId! : '';loadDraft()}})
function changeMeal(){target.value=''}
async function emoji(value:string){
  const field=textarea.value,start=field?.selectionStart??draft.value.text.length,end=field?.selectionEnd??start
  const text=draft.value.text.slice(0,start)+value+draft.value.text.slice(end)
  if(text.length>reviewTextLimit)return
  draft.value.text=text;await nextTick();field?.focus();field?.setSelectionRange(start+value.length,start+value.length)
}
async function save(){
  if(!allowed.value||!draft.value.text.trim()||saving.value||props.busy)return
  const key=draftKey.value,id=mealId.value,recipeId=target.value||null
  saving.value=true
  try {if(await props.save(id,recipeId,draft.value.text,draft.value.expected)){
    delete drafts[key];loadDraft();success.value='已保存，这份心意留在餐桌上了'
  }} finally {saving.value=false}
}
</script>
<template>
  <Modal v-if="open" title="餐后的悄悄话" sheet @close="!saving&&!busy&&emit('close')">
    <div class="review-center" :class="{'is-chef':isChef}">
      <div class="review-welcome"><span class="review-heart"><Heart :size="25"/></span><div><span class="eyebrow">A LITTLE THANK YOU</span><h3>{{isChef?'用心做的饭，有人记得。':'好吃的话，记得告诉 TA。'}}</h3><p>一句喜欢，一个表情，都是下次开火的动力。</p></div></div>
      <template v-if="meals.length">
        <label class="form-field review-meal-label">回味哪一餐<select v-model="mealId" :disabled="saving||busy" @change="changeMeal"><option v-for="m in meals" :key="m.id" :value="m.id">{{label(m.id)}}</option></select></label>
        <div class="review-target-heading"><b>把心意留给</b><small>每道菜都可以单独评价</small></div>
        <div class="review-targets"><button class="review-whole" :class="{selected:!target}" :aria-pressed="!target" :disabled="saving||busy" @click="target=''"><span>🍽️</span>这一整餐<Check v-if="!target" :size="16"/></button><label class="review-dish-picker"><span class="sr-only">选择评价菜品</span><select v-model="target" aria-label="选择评价菜品" :disabled="saving||busy"><option value="">或选一道菜…</option><option v-for="r in dishes" :key="r.id" :value="r.id">{{r.name}}{{(state.reviews??[]).some(v=>v.mealId===mealId&&v.userId===person&&v.recipeId===r.id)?' · 已评价':''}}</option></select></label></div>
        <form class="review-compose" @submit.prevent="save">
          <label for="review-message">{{own?'再补充一点心意':isChef?'也记下这一餐的感受':target?'这道菜，最喜欢哪一点？':`给${chefName}留句话`}}</label>
          <textarea id="review-message" ref="textarea" v-model="draft.text" :maxlength="reviewTextLimit" :disabled="saving||busy||!allowed" rows="4" placeholder="比如：火候刚刚好，今天也被这顿饭治愈了 🥰"></textarea>
          <div class="review-compose-bottom"><span>文字或 emoji 都可以</span><span>{{draft.text.length}} / {{reviewTextLimit}}</span></div>
          <div class="review-emojis" aria-label="快捷表情"><button v-for="[value,name] in [['😋','好吃'],['🥰','喜欢'],['❤️','爱心'],['👏','鼓掌'],['🍚','再来一碗']]" :key="value" type="button" :aria-label="'插入'+name+'表情'" :disabled="saving||busy||!allowed" @click="emoji(value)">{{value}}</button></div>
          <p v-if="changedElsewhere&&!saving" class="review-conflict" role="status">这条评价已在另一台设备更新，当前输入仍保留。<button type="button" class="text-button" @click="loadLatest">载入最新评价后修改</button></p>
          <button type="submit" class="btn primary full review-save" :disabled="saving||busy||!allowed||changedElsewhere||!draft.text.trim()||draft.text.length>reviewTextLimit">{{saving?'正在保存…':own?'保存修改':'保存这份心意'}}<Heart :size="17"/></button>
          <p v-if="success" class="review-success" role="status"><Check :size="16"/>{{success}}</p>
          <p class="review-privacy">本厨房内可见 · 可以回来修改 · 切换菜品会保留未保存的文字</p>
        </form>
        <section class="review-memories"><div class="review-target-heading"><h3>{{target?'这道菜的回声':'这一餐的回声'}}</h3><small>{{feed.length}} 份心意</small></div><ReviewFeed :reviews="feed" :state="state" :person="person"/><div v-if="!feed.length" class="review-empty"><MessageCircle :size="25"/><p>还没有留言，第一句喜欢就从你开始。</p></div></section>
      </template>
      <div v-else class="review-empty"><span class="review-empty-emoji">🍵</span><h3>好饭不怕晚，好话也是。</h3><p>有菜品的餐次结束后，就能在这里<br>评价整餐，也能单独夸一道菜。</p><button class="btn secondary" @click="emit('close')">回到厨房<ArrowRight :size="16"/></button></div>
    </div>
  </Modal>
</template>
