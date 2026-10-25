<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { ArrowDown, ArrowUp, Check, ChefHat, Plus, Trash2 } from 'lucide-vue-next'
import Modal from './Modal.vue'
import FoodArt from './FoodArt.vue'
import { type Ingredient, type Recipe } from '../domain'
import { fingerprint, sharedBusy } from '../shared'
import { coverIsReference } from '../recipe-content'
import type { Command } from '../../server/commands'

const props=defineProps<{recipe?:Recipe;kitchenId:string;menuIds:string[];categories:string[];send:(c:Command)=>Promise<boolean>}>()
const emit=defineEmits<{close:[];saved:[]}>()
// Capture the opened version, not the live reactive record, for concurrent edits.
const expected=fingerprint(props.recipe),menuExpected=fingerprint(props.menuIds)
const form=reactive({name:props.recipe?.name??'',category:props.recipe?.category??'家常小炒',minutes:props.recipe?.minutes??'' as number|string,servings:props.recipe?.servings??'' as number|string,note:props.recipe?.note??'',art:props.recipe?.art??'tofu',source:props.recipe?.source??'',ingredients:props.recipe?.ingredients.map(i=>({...i,amount:i.amount??'' as number|string}))??[{name:'',amount:'' as number|string,unit:'份',type:'food' as Ingredient['type']}],steps:props.recipe?.steps.length?[...props.recipe.steps]:['']})
const error=ref(''),removeConfirm=ref(false)
const covers=computed(()=>[...(props.recipe?.art.startsWith('/images/')?[{id:props.recipe.art,name:'原有封面'}]:[]),{id:'placeholder',name:'暂不配图'},{id:'tomato',name:'暖心家常'},{id:'greens',name:'清爽时蔬'},{id:'shrimp',name:'鲜香海味'},{id:'tofu',name:'金黄煎烤'},{id:'soup',name:'一碗热汤'},...(props.recipe?.art==='beef'?[{id:'beef',name:'原有插画'}]:[])])
const isInMenu=computed(()=>!!props.recipe&&props.menuIds.includes(props.recipe.id))
const numberOrNull=(value:number|string)=>value===''?null:Number(value)
async function save(){
  error.value=''
  if(!form.name.trim()||!form.category.trim()){error.value='请填写菜名和分类';return}
  const minutes=numberOrNull(form.minutes),servings=numberOrNull(form.servings)
  if((minutes!==null&&(!Number.isInteger(minutes)||minutes<1||minutes>600))||(servings!==null&&(!Number.isInteger(servings)||servings<1||servings>20))){error.value='时长请填 1—600 分钟，人数请填 1—20 的整数；未知可留空。';return}
  const ingredients:Ingredient[]=form.ingredients.map(i=>({name:i.name.trim(),amount:numberOrNull(i.amount),unit:i.unit.trim(),type:i.type}))
  if(!ingredients.length||ingredients.some(i=>!i.name||!i.unit||(i.amount!==null&&(!Number.isFinite(i.amount)||i.amount<0||i.amount>1e7)))){error.value='请补全食材名称、单位，数量未知可留空。';return}
  const source=form.source.trim()
  if(source){try{if(!['http:','https:'].includes(new URL(source).protocol))throw Error()}catch{error.value='来源链接请填写完整的 http 或 https 地址';return}}
  const ok=await props.send({type:'recipe.save',kitchenId:props.kitchenId,oldId:props.recipe?.id,expected,menuExpected,value:{name:form.name.trim(),category:form.category.trim(),minutes,servings,note:form.note.trim(),art:form.art,ingredients,steps:form.steps.map(s=>s.trim()).filter(Boolean),source}})
  if(ok)emit('saved');else error.value='尚未保存成功，输入已保留。请根据提示重试。'
}
async function remove(){if(props.recipe&&await props.send({type:'recipe.remove',kitchenId:props.kitchenId,recipeId:props.recipe.id}))emit('saved')}
function move(index:number,delta:number){const target=index+delta;if(target<0||target>=form.steps.length)return;[form.steps[index],form.steps[target]]=[form.steps[target],form.steps[index]]}
</script>
<template>
  <Modal :title="recipe?'编辑我家的菜谱':'记下一道拿手菜'" wide sheet @close="!sharedBusy&&emit('close')">
    <form id="recipe-editor" class="recipe-editor" @submit.prevent="save">
      <div class="editor-intro"><ChefHat :size="23"/><p>让每一道菜，都有我家的味道。<small>修改仅用于这个厨房，已点菜单与餐后记录保留原版。</small></p></div>
      <fieldset :disabled="sharedBusy">
        <section><h3>01 <span>菜品名片</span></h3><div class="form-grid"><label class="form-field">菜名<input v-model="form.name" required maxlength="80" placeholder="给这道菜起个名字"></label><label class="form-field">分类<input v-model="form.category" list="recipe-category-options" required maxlength="80" placeholder="选择或填写分类"><datalist id="recipe-category-options"><option v-for="c in categories" :key="c" :value="c"/></datalist></label></div><div class="form-grid"><label class="form-field">参考人数<input v-model="form.servings" type="number" min="1" max="20" step="1" placeholder="选填 · 人"></label><label class="form-field">预计时长<input v-model="form.minutes" type="number" min="1" max="600" step="1" placeholder="选填 · 分钟"></label></div><label class="form-field">一句话介绍<textarea v-model="form.note" rows="2" maxlength="200" placeholder="记下这道菜让人惦记的地方"></textarea></label><label class="form-field">菜品封面</label><div class="editor-covers"><button v-for="cover in covers" :key="cover.id" type="button" :class="{selected:form.art===cover.id}" :aria-label="'封面：'+cover.name" :aria-pressed="form.art===cover.id" @click="form.art=cover.id"><FoodArt :kind="cover.id" :reference="!!recipe&&cover.id===recipe.art&&coverIsReference(recipe)"/><span>{{cover.name}}</span><Check v-if="form.art===cover.id" class="cover-check" :size="16"/></button></div></section>
        <section><h3>02 <span>准备这些食材</span></h3><p class="small-note">按参考人数填写用量。未知数量留空，调料也可记为适量。</p><article v-for="(i,index) in form.ingredients" :key="index" class="editor-ingredient"><div class="ingredient-heading"><b>食材 {{String(index+1).padStart(2,'0')}}</b><button type="button" class="icon-btn" :aria-label="'移除食材'+(index+1)" :disabled="form.ingredients.length<=1" @click="form.ingredients.splice(index,1)"><Trash2 :size="17"/></button></div><label class="form-field">名称<input v-model="i.name" required maxlength="80" placeholder="例如：芹菜、酱油"></label><div class="ingredient-amounts"><label class="form-field">数量<input v-model="i.amount" type="number" min="0" max="10000000" step="any" placeholder="适量"></label><label class="form-field">单位<input v-model="i.unit" required maxlength="16" list="recipe-unit-options" placeholder="克 / 份"></label><label class="form-field">类型<select v-model="i.type" :aria-label="'食材'+(index+1)+'类型'"><option value="food">食材</option><option value="seasoning">调料</option></select></label></div></article><datalist id="recipe-unit-options"><option v-for="unit in ['克','千克','斤','两','毫升','个','份','勺','瓶']" :key="unit" :value="unit"/></datalist><button type="button" class="btn secondary full" :disabled="form.ingredients.length>=100" @click="form.ingredients.push({name:'',amount:'',unit:'份',type:'food'})"><Plus :size="17"/>再添一种食材</button></section>
        <section><h3>03 <span>一步一步慢慢来</span></h3><article v-for="(_,index) in form.steps" :key="index" class="editor-step"><div class="ingredient-heading"><b>步骤 {{String(index+1).padStart(2,'0')}}</b><div><button type="button" class="icon-btn" :disabled="index===0" :aria-label="'上移步骤'+(index+1)" @click="move(index,-1)"><ArrowUp :size="16"/></button><button type="button" class="icon-btn" :disabled="index===form.steps.length-1" :aria-label="'下移步骤'+(index+1)" @click="move(index,1)"><ArrowDown :size="16"/></button><button type="button" class="icon-btn" :aria-label="'移除步骤'+(index+1)" @click="form.steps.splice(index,1)"><Trash2 :size="16"/></button></div></div><label class="form-field"><span class="sr-only">步骤 {{index+1}} 做法</span><textarea v-model="form.steps[index]" rows="3" maxlength="3000" placeholder="描述这一步的做法、火候与时间（选填）"></textarea></label></article><button type="button" class="btn secondary full" :disabled="form.steps.length>=100" @click="form.steps.push('')"><Plus :size="17"/>增加一个步骤</button></section>
        <section><h3>04 <span>灵感出处</span></h3><label class="form-field">来源链接（选填）<input v-model="form.source" type="url" maxlength="2000" placeholder="https://…"></label><p v-if="recipe?.sourceText" class="small-note">导入时的原始教程会随新版本保留，可在菜谱详情中查看。</p></section>
        <div v-if="isInMenu" class="editor-remove"><button type="button" class="text-button" @click="removeConfirm=!removeConfirm"><Trash2 :size="16"/>从自家菜单移除</button><div v-if="removeConfirm"><p class="small-note">移除后不再供新点菜选择。已有订单与历史记录保留；公共菜谱可在发现页重新加入。</p><button type="button" class="btn secondary full" @click="remove">确认从菜单移除</button></div></div>
      </fieldset>
      <p v-if="error" class="auth-error" role="alert">{{error}}</p>
    </form>
    <template #footer><button form="recipe-editor" type="submit" class="btn primary full" :disabled="sharedBusy">{{sharedBusy?'正在保存…':'保存到自家菜单'}}<Check :size="18"/></button></template>
  </Modal>
</template>
<style scoped>
.recipe-editor{min-width:0;padding:20px 22px 24px}.recipe-editor fieldset{border:0;padding:0;margin:0;min-width:0}.editor-intro{display:flex;gap:12px;padding:16px;background:var(--paper);border-radius:16px;margin-bottom:24px;color:var(--orange)}.editor-intro svg{flex-shrink:0}.editor-intro p{margin:0;line-height:1.6;font-weight:600}.editor-intro small{display:block;color:var(--muted);font-weight:400;font-size:12px;margin-top:5px}.recipe-editor section{margin-bottom:28px}.recipe-editor h3{display:flex;align-items:center;gap:12px;font-size:13px;color:var(--orange);margin:0 0 18px}.recipe-editor h3 span{font-size:17px;color:var(--ink)}.editor-covers{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.editor-covers button{position:relative;border:1px solid var(--line);border-radius:14px;padding:0 0 10px;overflow:hidden;background:var(--paper);color:var(--muted);min-width:0}.editor-covers button.selected{border:2px solid var(--orange);color:var(--orange)}.editor-covers .food-art{display:block;width:100%;height:85px}.editor-covers span{font-size:12px}.cover-check{position:absolute;top:7px;right:7px;background:var(--orange);color:white;border-radius:50%;padding:2px;box-sizing:content-box}.editor-ingredient,.editor-step{border:1px solid var(--line);padding:14px;border-radius:16px;margin-bottom:12px}.ingredient-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}.ingredient-heading b{font-size:12px;color:var(--muted);letter-spacing:1px}.ingredient-heading>div{display:flex}.ingredient-heading button{width:44px;height:44px}.ingredient-amounts{display:grid;grid-template-columns:1fr 1fr 1.15fr;gap:10px}.ingredient-amounts .form-field{min-width:0;margin-bottom:0}.recipe-editor input,.recipe-editor select,.recipe-editor textarea{width:100%;min-width:0;box-sizing:border-box}.editor-remove{padding:18px 0 0;border-top:1px dashed var(--line);color:#a23e35}.editor-step .form-field{margin-bottom:0}.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%)}
@media(max-width:400px){.editor-ingredient,.editor-step{padding:10px}.ingredient-amounts{gap:6px}.ingredient-amounts input,.ingredient-amounts select{padding-left:9px;padding-right:9px}}
</style>
