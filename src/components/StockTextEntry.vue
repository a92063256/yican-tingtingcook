<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Check, CircleHelp, CookingPot, Plus, Sprout, TextCursorInput, Trash2 } from 'lucide-vue-next'
import Modal from './Modal.vue'
import type { Ingredient, Stock } from '../domain'
import { parseStockText, stockUnits, type StockTextIssue, type StockTextRow } from '../stock-text'
import { fingerprint } from '../shared'

export interface StockAddition { value:Ingredient; expected:string|null }
const props=defineProps<{stock:Stock[];save:(items:StockAddition[])=>Promise<void>}>()
const emit=defineEmits<{close:[]}>()
const text=ref(''),rows=ref<StockTextRow[]>([]),issues=ref<StockTextIssue[]>([]),saving=ref(false),error=ref('')
const pending=ref<StockAddition[]|null>(null)
const example='芹菜一斤，酱油一瓶、猪肉罐头 2份。鸡蛋，10个。香菇'
watch(text,value=>{
  if(pending.value)return
  const parsed=parseStockText(value)
  rows.value=parsed.rows.map(row=>{
    const old=props.stock.find(s=>s.name===row.value.name&&s.unit===row.value.unit)
    return {...row,value:{...row.value,type:old?.type??row.value.type}}
  })
  issues.value=parsed.issues;error.value=''
})
const combined=computed(()=>{
  const map=new Map<string,Ingredient>(),problems:string[]=[]
  for(const {value} of rows.value){
    const name=value.name.trim(),amount=Number(value.amount),key=JSON.stringify([name,value.unit])
    if(!name||name.length>80||value.amount===null||String(value.amount)===''||!Number.isFinite(amount)||amount<.0001||amount>1e7){problems.push('每项都需要名称，数量需在 0.0001 到 10000000 之间。');continue}
    const prior=map.get(key)
    if(prior&&prior.type!==value.type)problems.push(`「${name}」重复项的分类不同，请统一分类。`)
    map.set(key,{...value,name,amount:Math.round(((prior?.amount??0)+amount)*10000)/10000})
  }
  const items=[...map.values()]
  for(const item of items){
    const old=props.stock.find(s=>s.name===item.name&&s.unit===item.unit)
    if(old?.amount===null)problems.push(`「${item.name}」原数量待确认，请先在库存中补充，再追加。`)
    if(old&&old.type!==item.type)problems.push(`「${item.name}」已有分类为${old.type==='food'?'食材':'调料'}，请保持相同分类。`)
    if((old?.amount??0)+(item.amount??0)>1e7)problems.push(`「${item.name}」合计数量过大，请核对。`)
  }
  return {items,problems:[...new Set(problems)]}
})
const canSave=computed(()=>!saving.value&&(!!pending.value||(!issues.value.length&&!combined.value.problems.length&&combined.value.items.length>0)))
function oldStock(value:Ingredient){return props.stock.find(s=>s.name===value.name.trim()&&s.unit===value.unit)}
function close(){if(!saving.value&&!pending.value)emit('close')}
async function submit(){
  if(!canSave.value)return
  saving.value=true;error.value=''
  const items=pending.value??combined.value.items.map(value=>({value:{...value},expected:fingerprint(oldStock(value))}))
  pending.value=items
  try{await props.save(items);pending.value=null;emit('close')}
  catch(e){const failure=e as Error&{status?:number};error.value=failure.message;if(failure.status)pending.value=null}
  finally{saving.value=false}
}
</script>

<template>
  <Modal title="一段话，记下新采购" sheet @close="close">
    <form id="stock-text-form" class="stock-text-form" @submit.prevent="submit">
      <div class="stock-text-welcome"><span><TextCursorInput :size="25"/></span><div><h3>随手写，我们帮你整理。</h3><p>中英文逗号、顿号、分号、斜杠或换行都可以。</p></div></div>
      <label class="form-field" for="stock-text-input">这次买了什么？<textarea id="stock-text-input" v-model="text" rows="5" maxlength="10000" :disabled="saving||!!pending" :placeholder="example" aria-describedby="stock-text-hint"/></label>
      <div id="stock-text-hint" class="stock-text-hint"><span>没写数量，按 1 份记录</span><button type="button" :disabled="saving||!!pending" @click="text=example">试填示例</button></div>
      <p class="stock-text-rules"><CircleHelp :size="16"/><span>同名同单位会累加；瓶、份不折算重量。不自动扣减库存，也不设置保质期。</span></p>
      <div v-if="issues.length" class="stock-text-issues" role="alert"><b>这几处需要再说清楚</b><p v-for="(issue,i) in issues" :key="i"><strong v-if="issue.raw">「{{issue.raw}}」</strong>{{issue.message}}</p><small>修改上方文字后会重新整理，确认前不会入库。</small></div>
      <div v-if="rows.length" class="stock-text-result">
        <div class="stock-text-result-head"><h3>整理好了 <span>{{combined.items.length}} 项</span></h3><small>可直接修改</small></div>
        <fieldset :disabled="saving||!!pending">
          <article v-for="(row,index) in rows" :key="index" class="stock-text-row">
            <div class="stock-text-row-head"><span class="stock-text-icon"><CookingPot v-if="row.value.type==='seasoning'" :size="18"/><Sprout v-else :size="18"/></span><input v-model="row.value.name" :aria-label="'第'+(index+1)+'项名称'" maxlength="80" required><button type="button" class="icon-btn" :aria-label="'移除第'+(index+1)+'项'" @click="rows.splice(index,1)"><Trash2 :size="17"/></button></div>
            <div class="stock-text-row-fields"><label>数量<input v-model.number="row.value.amount" type="number" inputmode="decimal" step="any" min="0.0001" max="10000000" required :aria-label="'第'+(index+1)+'项数量'"></label><label>单位<select v-model="row.value.unit" :aria-label="'第'+(index+1)+'项单位'"><option v-for="unit in stockUnits" :key="unit">{{unit}}</option></select></label><label>分类<select v-model="row.value.type" :aria-label="'第'+(index+1)+'项分类'"><option value="food">食材</option><option value="seasoning">调料</option></select></label></div>
            <p class="stock-text-row-note"><template v-if="oldStock(row.value)"><Plus :size="12"/>追加到已有库存</template><template v-else-if="row.defaulted">未写数量，已按 1 份整理，可修改</template><template v-else>来自：{{row.raw}}</template></p>
          </article>
        </fieldset>
      </div>
      <div v-else-if="!text.trim()" class="stock-text-empty"><Sprout :size="29"/><p>一口气记下，让采购轻松一点。</p><small>支持“干辣椒一斤”“番茄（三个）”“五花肉×2份”</small></div>
      <p v-for="problem in combined.problems" :key="problem" class="stock-text-error" role="alert">{{problem}}</p>
      <p v-if="error" class="stock-text-error" role="alert">{{error}}</p>
      <p v-if="pending&&!saving" class="stock-text-rules">本次结果尚未确认，请点击重试确认入库；重复请求不会再次累加。</p>
    </form>
    <template #footer><div class="stock-text-actions"><button type="button" class="btn secondary" :disabled="saving||!!pending" @click="close">取消</button><button class="btn primary" type="submit" form="stock-text-form" :disabled="!canSave"><Check :size="17"/>{{saving?'正在入库…':pending?'重试并确认':`确认入库${combined.items.length?' · '+combined.items.length+' 项':''}`}}</button></div></template>
  </Modal>
</template>

<style scoped>
.stock-text-form{padding:20px;color:var(--ink)}.stock-text-welcome{display:flex;gap:12px;align-items:center;margin-bottom:22px}.stock-text-welcome>span{display:grid;place-items:center;flex:0 0 48px;height:48px;background:var(--soft-orange);color:var(--orange);border-radius:15px}.stock-text-welcome h3{font-size:17px;margin:0 0 6px}.stock-text-welcome p{font-size:12px;color:var(--muted);margin:0;line-height:1.7}.stock-text-form .form-field{margin-bottom:8px}.stock-text-form textarea{resize:vertical;min-height:136px;line-height:1.85;font-size:16px}.stock-text-hint{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;color:var(--muted)}.stock-text-hint button{min-height:44px;background:none;border:0;color:var(--orange);padding:0 8px;font:inherit;font-weight:600}.stock-text-rules{display:flex;align-items:flex-start;gap:8px;font-size:12px;line-height:1.8;color:var(--muted);margin:12px 0 20px}.stock-text-rules svg{flex-shrink:0;margin-top:3px}.stock-text-result-head{display:flex;justify-content:space-between;align-items:center;margin:24px 0 12px}.stock-text-result-head h3{font-size:15px;margin:0}.stock-text-result-head h3 span{color:var(--orange);margin-left:5px}.stock-text-result-head small{font-size:11px;color:var(--muted)}fieldset{border:0;padding:0;margin:0;min-width:0}.stock-text-row{border:1px solid var(--line);border-radius:14px;padding:10px 12px;margin:0 0 12px;background:var(--white)}.stock-text-row-head{display:flex;align-items:center;gap:8px}.stock-text-icon{color:var(--orange);display:flex;flex-shrink:0}.stock-text-row input,.stock-text-row select{min-width:0;min-height:44px;width:100%;font-size:16px;border:1px solid var(--line);border-radius:9px;background:var(--paper);color:var(--ink);padding:8px}.stock-text-row-head input{flex:1;width:0;border-color:transparent;background:transparent;font-weight:600}.stock-text-row-head .icon-btn{flex:0 0 44px;width:44px;height:44px}.stock-text-row-fields{display:grid;grid-template-columns:1fr .9fr 1fr;gap:9px;margin-top:8px}.stock-text-row-fields label{min-width:0;font-size:11px;color:var(--muted);display:grid;gap:6px}.stock-text-row-note{display:flex;align-items:center;gap:4px;font-size:11px;color:var(--muted);line-height:1.7;margin:9px 0 2px;overflow-wrap:anywhere}.stock-text-issues{padding:14px;background:var(--soft-orange);border:1px solid var(--line);border-radius:12px;font-size:12px;line-height:1.8;overflow-wrap:anywhere}.stock-text-issues b{color:var(--orange)}.stock-text-issues p{margin:8px 0}.stock-text-issues small{color:var(--muted)}.stock-text-error{font-size:12px;line-height:1.8;color:#a74535;overflow-wrap:anywhere}.stock-text-empty{text-align:center;padding:26px 0;color:var(--muted)}.stock-text-empty svg{color:var(--orange)}.stock-text-empty p{font-size:13px;margin:12px 0 8px}.stock-text-empty small{font-size:11px}.stock-text-actions{display:grid;grid-template-columns:1fr 2fr;gap:12px}.stock-text-actions .btn{min-height:48px}button:disabled{opacity:.5;cursor:default}
@media(max-width:360px){.stock-text-form{padding:16px}.stock-text-welcome h3{font-size:15px}.stock-text-row{padding:9px}.stock-text-row-fields{gap:6px}}
</style>
