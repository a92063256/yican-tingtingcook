<script setup lang="ts">
import { computed, nextTick, onUnmounted, reactive, ref, watch } from 'vue'
import { ArrowRight, ArrowUpRight, CalendarDays, Check, CheckCheck, ChefHat, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, CookingPot, Heart, House, Leaf, ListChecks, LockKeyhole, KeyRound, MessageCircle, Minus, Plus, Search, Settings2, ShoppingBasket, Sparkles, Sprout, Users, Utensils, X, BookOpen, BookHeart, Pencil, Copy, Link, CheckCircle2, AlertCircle, SlidersHorizontal, Trash2 } from 'lucide-vue-next'
import Modal from './components/Modal.vue'
import FoodArt from './components/FoodArt.vue'
import KitchenNameEditor from './components/KitchenNameEditor.vue'
import ReviewCenter from './components/ReviewCenter.vue'
import ReviewFeed from './components/ReviewFeed.vue'
import ThemePicker from './components/ThemePicker.vue'
import MealJournal from './components/MealJournal.vue'
import AccountSettings from './components/AccountSettings.vue'
import FeedbackGateway from './components/FeedbackGateway.vue'
import KitchenManagement from './components/KitchenManagement.vue'
import { coverIsReference, recipeOriginUrl } from './recipe-content'
import RecipeEditor from './components/RecipeEditor.vue'
import StockTextEntry, { type StockAddition } from './components/StockTextEntry.vue'
import { stockUnits } from './stock-text'
import { account } from './account'
import { applyTheme, readTheme, themeStorageKey, type Theme } from './themes'
import { canReviewMeal, recipeReviews, reviewRecipes, reviewTextLimit } from './reviews'
import { lanEnabled, sharedStatus, sharedBusy, serverOffset, connectShared, fingerprint, newId } from './shared'
import type { Command } from '../server/commands'
import { emptyMarks, favoriteKey, toggleMark, dateOrderMark, monthCells } from './preferences'
import { activeGrant, canOrder, dateKey, hasAccess, isKitchenHost, dinerOwner, isPrepared, memberRole, people, shoppingList, visibleKitchens, type Ingredient, type Invite, type Meal, type Recipe, type Role, type ShoppingRow, type State } from './domain'

const initial:State=window.__YICAN_BOOT__!.state!
// Preserve existing browser data while retiring the legacy ordinary category.
for (const recipe of initial.recipes) {
  if (recipe.category === '拿手好菜') recipe.category = recipe.art === 'tofu' ? '煎烤小食' : '风味好菜'
}
initial.recipeMarks ??= emptyMarks()
initial.reviews ??= []
const state = reactive<State>(initial)
const shared=connectShared(state)
onUnmounted(()=>shared.stop())
async function sendShared(command:Command) {try{return await shared.send(person.value,command)}catch(error){notify((error as Error).message);return null}}
const marks = computed(() => state.recipeMarks ?? (state.recipeMarks = emptyMarks()))
const savedPerson=account.value!.id
const person = ref(savedPerson), kitchenId = ref(''), page = ref('menu'), category = ref('全部'), search = ref('')
const clock = ref(Date.now())
const timer = window.setInterval(() => clock.value=Date.now(), 1000)
onUnmounted(() => clearInterval(timer))
const now = computed(() => clock.value+serverOffset.value)
const ownKitchens = computed(() => visibleKitchens(state, person.value, now.value))
const kitchen = computed(() => state.kitchens.find(k => k.id === kitchenId.value))
const kitchenAvatars = computed(() => {
  const k=kitchen.value
  if(!k)return []
  const ids=[k.chefId,dinerOwner(state,k),...state.members.filter(m=>m.kitchenId===k.id).map(m=>m.userId)]
  return [...new Set(ids)].flatMap(id=>id&&state.people?.[id]?[{id,...state.people[id]}]:[]).slice(0,2)
})
const longRole = computed(() => memberRole(state,person.value,kitchenId.value))
const role = computed(() => longRole.value || (ownKitchens.value.some(k=>k.id===kitchenId.value) ? 'diner' : undefined))
const isChef = computed(() => role.value==='chef')
const canManage = computed(() => !!kitchen.value&&isKitchenHost(state,person.value,kitchen.value))
const identityLabel=computed(()=>isChef.value?kitchen.value?.chefLabel:canManage.value?'点菜主人':'客人')
const expired = computed(() => !!kitchenId.value && !role.value)
const mealId = ref('home-1-1')
const meal = computed(() => state.meals.find(m=>m.id===mealId.value && m.kitchenId===kitchenId.value))
const allowedMeals = computed(() => state.meals.filter(m=>m.kitchenId===kitchenId.value && hasAccess(state,person.value,m,now.value)))
const selectedDate = ref(state.meals.find(m=>m.id==='home-1-1')?.date||dateKey(new Date()))
watch(allowedMeals,list=>{if(!meal.value&&list.length){const target=list.find(m=>m.status==='open'&&+new Date(m.deadline)>now.value)??list[0];mealId.value=target.id;selectedDate.value=target.date}})
const dates = computed(() => [...new Set(allowedMeals.value.map(m=>m.date))].sort())
const chooser = ref(false), modal = ref(''), recipeDetail = ref<Recipe|null>(null), toast = ref('')
const editingRecipe=ref<Recipe>()
async function sendManagement(command:Command){return !!await sendShared(command)}
function leftKitchen(){modal.value='';recipeDetail.value=null;autoEnter();notify('已离开这个厨房')}
watch(kitchen, (value,old)=>{if(!value&&old){modal.value='';recipeDetail.value=null;autoEnter()}})
let toastTimer: ReturnType<typeof setTimeout>
function notify(text:string) { toast.value=text; clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.value='',3800) }
const currentTheme = ref(readTheme())
function changeTheme(theme:Theme) {
  currentTheme.value=theme;applyTheme(theme)
  try {localStorage.setItem(themeStorageKey,theme.id)} catch {notify('主题已切换，浏览器限制存储，关闭后可能无法保留')}
}
function openJournalReviews(id:string) {reviewMealId.value=id;reviewRecipeId.value=null;reviewOpen.value=true}
const carts = reactive<Record<string,string[]>>({})
const cartKey = computed(()=>`${person.value}:${mealId.value}`)
const chosen = computed(()=>carts[cartKey.value] || [])
const selectedRecipes = computed(()=>chosen.value.map(id=>state.recipes.find(r=>r.id===id)).filter((r):r is Recipe=>!!r))
const note = ref('')
const ownOrder = computed(()=>state.orders.find(o=>o.userId===person.value && o.mealId===mealId.value))
const orders = computed(()=>state.orders.filter(o=>o.mealId===mealId.value))
const orderedRecipes = computed(()=>[...new Set(orders.value.flatMap(o=>o.recipeIds))].map(id=>state.recipes.find(r=>r.id===id)).filter((r):r is Recipe=>!!r))
const rows = computed(()=>meal.value && isChef.value ? shoppingList(state,meal.value) : [])
const missingRows = computed(()=>rows.value.filter(r=>!isPrepared(state,mealId.value,r)))
const listFilter = ref('all')
const shownRows = computed(()=>listFilter.value==='missing' ? missingRows.value : rows.value)
const canSubmit = computed(()=>!!meal.value && canOrder(state,person.value,meal.value,now.value))
const menuRecipes = computed(()=>state.recipes.filter(r=>kitchen.value?.recipeIds.includes(r.id)))
const publicRecipes = computed(() => state.recipes.filter(r=>!r.archived&&!r.id.startsWith('private-')))
const baseRecipes = computed(() => page.value==='library' ? publicRecipes.value : menuRecipes.value)
const recipeCategories = computed(() => [...new Set([...['家常小炒','风味好菜','煎烤小食','清爽时蔬','暖心汤羹'], ...state.recipes.map(r=>r.category)])])
const categories = computed(() => ['全部', '主厨拿手', '我的爱吃', ...new Set(baseRecipes.value.map(r=>r.category))])
const signatureIds = computed(() => marks.value.signatures[kitchenId.value] ?? [])
const favoriteIds = computed(() => marks.value.favorites[favoriteKey(kitchenId.value,person.value)] ?? [])
function matchesCategory(r:Recipe,c:string) {return c==='全部'||(c==='主厨拿手'?signatureIds.value.includes(r.id):c==='我的爱吃'?favoriteIds.value.includes(r.id):r.category===c)}
const displayRecipes = computed(() => baseRecipes.value.filter(r=>matchesCategory(r,category.value)&&(!search.value||r.name.includes(search.value)||r.ingredients.some(i=>i.name.includes(search.value)))))
function categoryCount(c:string) {return baseRecipes.value.filter(r=>matchesCategory(r,c)).length}
const menuResults = ref<HTMLElement|null>(null)
async function selectCategory(value:string) {
  if (category.value === value) return
  category.value = value
  await nextTick()
  menuResults.value?.scrollIntoView({ behavior:'smooth', block:'start' })
}
async function markRecipe(r:Recipe,kind:'signature'|'favorite') {
  if(!role.value||expired.value)return
  if(kind==='signature'&&(!isChef.value||!kitchen.value?.recipeIds.includes(r.id)))return
  if(lanEnabled){await sendShared({type:'recipe.mark',kitchenId:kitchenId.value,recipeId:r.id,kind,marked:!(kind==='signature'?signatureIds.value:favoriteIds.value).includes(r.id)});return}
  toggleMark(kind==='signature'?marks.value.signatures:marks.value.favorites,kind==='signature'?kitchenId.value:favoriteKey(kitchenId.value,person.value),r.id)
}
const calendarMonth=ref(selectedDate.value.slice(0,7)), calendarDate=ref(selectedDate.value)
const calendarCells=computed(()=>monthCells(calendarMonth.value))
const calendarMeals=computed(()=>allowedMeals.value.filter(m=>m.date===calendarDate.value))
const calendarHeading=computed(()=>{const [y,m]=calendarMonth.value.split('-');return y+'年 '+Number(m)+'月'})
function openCalendar() {calendarDate.value=selectedDate.value;calendarMonth.value=selectedDate.value.slice(0,7);modal.value='calendar'}
function moveMonth(delta:number) {const [y,m]=calendarMonth.value.split('-').map(Number);calendarMonth.value=dateKey(new Date(y,m-1+delta,1,12)).slice(0,7);calendarDate.value=dates.value.find(d=>d.startsWith(calendarMonth.value))||calendarMonth.value+'-01'}
function orderMark(date:string) {return dateOrderMark(state,allowedMeals.value.filter(m=>m.date===date).map(m=>m.id),person.value)}
function calendarLabel(date:string) {const mark=orderMark(date);return dateText(date,true)+(mark.mine?'，我已点':'')+(mark.others?'，有人点':'')+(!dates.value.includes(date)?'，未开放餐次':'')}
function confirmMeal(m:Meal) {selectedDate.value=m.date;mealId.value=m.id;modal.value=''}
function showCart() {modal.value='cart'}
const reviewOpen=ref(false), reviewMealId=ref(''), reviewRecipeId=ref<string|null>(null)
const detailReviews=computed(()=>recipeDetail.value?recipeReviews(state,kitchenId.value,recipeDetail.value,person.value):[])
function openReviews(recipeId:string|null=null) {
  reviewMealId.value=mealId.value;reviewRecipeId.value=recipeId;reviewOpen.value=true
}
function reviewDish(r:Recipe) {
  const eligible=state.meals.filter(m=>m.kitchenId===kitchenId.value&&canReviewMeal(state,person.value,m,now.value)&&state.orders.some(o=>o.mealId===m.id&&o.recipeIds.some(id=>{const old=state.recipes.find(v=>v.id===id);return old&&(old.reviewKey??old.id)===(r.reviewKey??r.id)&&(m.portions[id]??1)>0}))).sort((a,b)=>b.startsAt.localeCompare(a.startsAt))[0]
  if(!eligible)return notify('用餐结束后，可以评价这餐准备过的菜品')
  const old=state.recipes.find(v=>(v.reviewKey??v.id)===(r.reviewKey??r.id)&&state.orders.some(o=>o.mealId===eligible.id&&o.recipeIds.includes(v.id))&&(eligible.portions[v.id]??1)>0)
  reviewMealId.value=eligible.id;reviewRecipeId.value=old?.id??null;recipeDetail.value=null;reviewOpen.value=true
}
async function saveReview(id:string,recipeId:string|null,text:string,expected:string|null):Promise<boolean> {
  if(lanEnabled)return !!await sendShared({type:'review.save',mealId:id,recipeId,text,expected})
  const m=state.meals.find(m=>m.id===id)
  if(!m||!canReviewMeal(state,person.value,m,now.value)||!text.trim()||text.length>reviewTextLimit||(recipeId&&!reviewRecipes(state,m).some(r=>r.id===recipeId)))return false
  const list=state.reviews??=[],old=list.find(r=>r.mealId===id&&r.userId===person.value&&r.recipeId===recipeId)
  if(fingerprint(old)!==expected){notify('评价已更新，请重新打开后修改');return false}
  const stamp=new Date(now.value).toISOString(),r=state.recipes.find(r=>r.id===recipeId)
  if(old){old.text=text.trim();old.updatedAt=stamp}else list.push({id:newId(),kitchenId:m.kitchenId,mealId:id,userId:person.value,recipeId,recipeKey:r?(r.reviewKey??r.id):null,text:text.trim(),createdAt:stamp,updatedAt:stamp})
  return true
}
const statusNames = {open:'正在点菜',prep:'备菜中',cooking:'正在做饭',done:'本餐已完成',cancelled:'已取消'}
const dateText = (date:string, full=false)=>new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN',full?{month:'long',day:'numeric',weekday:'long'}:{month:'numeric',day:'numeric'})
const timeText = (date:string)=>new Date(date).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})
const qty = (amount:number|null,unit:string)=>amount===null?'适量 / 待确认':`${Math.round(amount*100)/100}${unit}`
const stockText = (item:State['stock'][number]) => item.amount===null?`数量待确认 · ${item.unit}`:item.amount===0?'已经用完':qty(item.amount,item.unit)
function chooseKitchen(id:string) {
  kitchenId.value=id; chooser.value=false; page.value=memberRole(state,person.value,id)==='chef'?'chef':'menu'; category.value='全部';search.value=''
  const list=state.meals.filter(m=>m.kitchenId===id && hasAccess(state,person.value,m,now.value))
  const target=list.find(m=>m.id===mealId.value) || list.find(m=>m.status==='open'&&+new Date(m.deadline)>now.value&&state.orders.some(o=>o.mealId===m.id)) || list.find(m=>+new Date(m.deadline)>now.value) || list[0]
  if(target) {mealId.value=target.id;selectedDate.value=target.date} else mealId.value=''
}
function autoEnter() { if(ownKitchens.value.length===1) chooseKitchen(ownKitchens.value[0].id);else {kitchenId.value='';chooser.value=ownKitchens.value.length>1} }
function navigate(value:string) {page.value=value;category.value='全部';search.value=''}
const orderExpected=ref<string|null>(null)
watch(cartKey,()=> {note.value=ownOrder.value?.note||'';orderExpected.value=fingerprint(ownOrder.value)})
function toggleDish(id:string) {
  if(!canSubmit.value) return notify('这餐暂时不能点菜，请选择开放的餐次')
  if(!chosen.value.length)orderExpected.value=fingerprint(ownOrder.value)
  const current=carts[cartKey.value] || []; carts[cartKey.value]=current.includes(id)?current.filter(i=>i!==id):[...current,id]
}
function editOrder() {if(!canSubmit.value)return notify('已开始备菜，暂不能修改');orderExpected.value=fingerprint(ownOrder.value);carts[cartKey.value]=[...(ownOrder.value?.recipeIds||[])];note.value=ownOrder.value?.note||'';page.value='menu';notify('已放回待选清单，修改后重新提交')}
async function submitOrder() {
  if(!canSubmit.value||!meal.value)return notify('本餐已停止点菜，未提交')
  if(!chosen.value.length)return notify('先选一道想吃的菜吧')
  if(lanEnabled){if(!await sendShared({type:'order.submit',mealId:mealId.value,recipeIds:[...chosen.value],note:note.value,expected:orderExpected.value}))return}
  else if(ownOrder.value) {ownOrder.value.recipeIds=[...chosen.value];ownOrder.value.note=note.value}
  else state.orders.push({id:newId(),userId:person.value,mealId:mealId.value,recipeIds:[...chosen.value],note:note.value,createdAt:new Date(now.value).toISOString()})
  carts[cartKey.value]=[];note.value='';modal.value='';page.value='orders';notify('想吃的菜已送到主厨面前')
}
async function cancelOrder() {if(!canSubmit.value)return notify('已开始备菜，暂不能撤回');if(lanEnabled){if(!await sendShared({type:'order.cancel',mealId:mealId.value,expected:fingerprint(ownOrder.value)}))return}else state.orders=state.orders.filter(o=>o!==ownOrder.value);notify('本餐点菜已撤回')}
async function setPortion(id:string,delta:number) {if(!isChef.value||!meal.value||['done','cancelled'].includes(meal.value.status))return;if(lanEnabled){await sendShared({type:'meal.portion',mealId:mealId.value,recipeId:id,delta:delta as 1|-1});return}meal.value.portions[id]=Math.max(0,(meal.value.portions[id]??1)+delta)}
async function updateStatus() {
  if(!isChef.value||!meal.value)return
  if(!orderedRecipes.value.length)return notify('还没有人点菜，可以先为自己加菜')
  const statuses=['open','prep','cooking','done'] as const
  const i=statuses.indexOf(meal.value.status as typeof statuses[number]); if(i<0||i>=3)return
  if(lanEnabled){if(!await sendShared({type:'meal.status',mealId:mealId.value,expected:meal.value.status as 'open'|'prep'|'cooking'}))return}else meal.value.status=statuses[i+1];notify(i===0?'菜单已确认，停止接收新点菜':i===1?'开火啦，祝你做饭愉快':'这一餐圆满完成，辛苦啦')
}
async function checkRow(row:ShoppingRow) {if(!isChef.value)return;if(lanEnabled){await sendShared({type:'shopping.check',mealId:mealId.value,key:row.key,signature:row.signature,prepared:!isPrepared(state,mealId.value,row)});return}state.checked[`${mealId.value}:${row.key}`]=`${isPrepared(state,mealId.value,row)?'no':'yes'}:${row.signature}`}
const stockType=ref('all')
const inventory=computed(()=>state.stock.filter(s=>s.kitchenId===kitchenId.value&&(stockType.value==='all'||s.type===stockType.value)))
const stockForm=reactive({id:'',name:'',amount:'' as string|number,unit:'克',type:'food' as 'food'|'seasoning'})
const stockExpected=ref<string|null>(null)
const kitchenStock=computed(()=>state.stock.filter(s=>s.kitchenId===kitchenId.value))
async function saveStockBatch(items:StockAddition[]) {
  if(!isChef.value)throw Object.assign(new Error('只有主厨可以添加库存'),{status:403})
  await shared.send(person.value,{type:'stock.batch',kitchenId:kitchenId.value,items})
  stockType.value='all';notify(`已将 ${items.length} 项采购记入库存`)
}
function editStock(id?:string) {const s=state.stock.find(s=>s.id===id);stockExpected.value=fingerprint(s);Object.assign(stockForm,s?{...s,amount:s.amount??''}:{id:'',name:'',amount:'',unit:'克',type:'food'});modal.value='stock'}
async function saveStock() {
  if(!isChef.value)return
  if(!stockForm.name.trim()||(!['',null].includes(stockForm.amount as string)&&(!Number.isFinite(Number(stockForm.amount))||Number(stockForm.amount)<0)))return notify('请填写食材名称和有效数量')
  const amount=stockForm.amount===''?null:Number(stockForm.amount)
  const duplicate=state.stock.find(s=>s.kitchenId===kitchenId.value&&s.name===stockForm.name.trim()&&s.unit===stockForm.unit&&s.id!==stockForm.id)
  if(duplicate)return notify('已有同名同单位库存，请编辑现有记录')
  const data={id:stockForm.id||newId(),kitchenId:kitchenId.value,name:stockForm.name.trim(),amount,unit:stockForm.unit,type:stockForm.type}
  if(lanEnabled){if(!await sendShared({type:'stock.save',kitchenId:kitchenId.value,id:stockForm.id||undefined,value:{name:data.name,amount:data.amount,unit:data.unit,type:data.type},expected:stockExpected.value}))return}
  else {const i=state.stock.findIndex(s=>s.id===stockForm.id);if(i>=0)state.stock[i]=data;else state.stock.push(data)}
  modal.value='';notify('库存已更新，食材清单会重新计算')
}
async function useUp(id:string) {if(!isChef.value)return;const s=state.stock.find(s=>s.id===id);if(!s)return;if(s.amount===null)return notify('数量待确认，请先填写数量；备菜不会自动清空库存');if(lanEnabled){if(!await sendShared({type:'stock.useup',id,expected:fingerprint(s)}))return}else s.amount=0;notify('已标记用完')}
const inviteType=ref<'temporary'|'long'>('long'), inviteMeal=ref(''), generated=ref<Invite|null>(null)
const invitableMeals=computed(()=>state.meals.filter(m=>m.kitchenId===kitchenId.value&&m.status==='open'&&+new Date(m.deadline)>now.value&&+new Date(m.endsAt)>now.value))
const shareUrl=computed(()=>{if(!generated.value)return '';const url=new URL(location.href);url.hash=`invite=${generated.value.id}`;return url.href})
function openInvite() {if(!canManage.value)return;inviteMeal.value=invitableMeals.value.find(m=>m.id===mealId.value)?.id??invitableMeals.value[0]?.id??'';generated.value=null;inviteType.value=inviteMeal.value?'temporary':'long';modal.value='invite'}
async function generateInvite() {
  if(!canManage.value)return
  const m=state.meals.find(m=>m.id===inviteMeal.value&&m.kitchenId===kitchenId.value)
  if(inviteType.value==='temporary'&&(!m||m.status!=='open'||now.value>=+new Date(m.deadline)))return notify('请选择仍可点菜的餐次')
  if(lanEnabled){const result=await sendShared({type:'invite.create',kitchenId:kitchenId.value,kind:inviteType.value,mealId:inviteType.value==='temporary'?inviteMeal.value:undefined});if(result)generated.value=state.invites.find(i=>i.id===result.id)||null;return}
  const inv:Invite={id:newId(),kitchenId:kitchenId.value,type:inviteType.value,mealId:inviteType.value==='temporary'?m!.id:undefined,expiresAt:inviteType.value==='temporary'?m!.endsAt:new Date(now.value+7*86400000).toISOString()}
  state.invites.push(inv);generated.value=inv
}
async function copyLink() {try {await navigator.clipboard.writeText(shareUrl.value);notify('邀请链接已复制')}catch{notify('请选中下方链接手动复制')}}
async function renameKitchen(name:string,previous:string) {
  if(!canManage.value||!kitchen.value)throw new Error('只有厨房主人可以修改厨房名称')
  if(lanEnabled)await shared.send(person.value,{type:'kitchen.rename',kitchenId:kitchenId.value,name,expected:fingerprint(previous)})
  else {if(kitchen.value.name!==previous)throw new Error('厨房名称已更新，请查看最新名字');kitchen.value.name=name}
  notify('厨房名字已更新，家人们都能看见')
}
const naming=reactive({name:'',chefLabel:'',dinerLabel:''})
const namingExpected=ref<string|null>(null)
function openNaming() {if(!kitchen.value)return;namingExpected.value=fingerprint({name:kitchen.value.name,chefLabel:kitchen.value.chefLabel,dinerLabel:kitchen.value.dinerLabel});Object.assign(naming,kitchen.value);modal.value='naming'}
async function saveNaming() {if(!canManage.value||!kitchen.value)return;if(!naming.name.trim()||!naming.chefLabel.trim()||!naming.dinerLabel.trim())return notify('名称不能留空');if(lanEnabled){if(!await sendShared({type:'kitchen.naming',kitchenId:kitchenId.value,name:naming.name,chefLabel:naming.chefLabel,dinerLabel:naming.dinerLabel,expected:namingExpected.value}))return}else Object.assign(kitchen.value,{name:naming.name.trim(),chefLabel:naming.chefLabel.trim(),dinerLabel:naming.dinerLabel.trim()});modal.value='';notify('厨房有了新的称呼')}
const createForm=reactive({name:'',role:(account.value?.preferredRole??'diner') as Role})
const inviteInput=ref(''),inviteInputError=ref('')
function enterInvite(){inviteInputError.value='';const raw=inviteInput.value.trim();try{const id=raw.includes('#')?new URLSearchParams(new URL(raw).hash.slice(1)).get('invite'):raw;if(!id||!/^[a-zA-Z0-9_-]{1,160}$/.test(id))throw new Error();location.hash='invite='+id}catch{inviteInputError.value='请粘贴完整邀请链接或邀请码'}}
async function createKitchen() {if(!createForm.name.trim())return notify('给厨房起个名字吧');if(lanEnabled){const result=await sendShared({type:'kitchen.create',name:createForm.name.trim(),role:createForm.role});if(result){modal.value='';chooseKitchen(result.id);notify('厨房建好了')}return}const id=newId();state.kitchens.push({id,name:createForm.name.trim(),subtitle:'把喜欢的人，放在一张餐桌旁。',chefId:createForm.role==='chef'?person.value:null,ownerId:person.value,chefLabel:'主厨',dinerLabel:'食客',recipeIds:['tomato','soup','greens']});state.members.push({userId:person.value,kitchenId:id,role:createForm.role});modal.value='';chooseKitchen(id);notify(createForm.role==='chef'?'厨房建好了，开启第一餐吧':'厨房建好了，先邀请一位主厨吧')}
const mealForm=reactive({date:dateKey(new Date()),name:'晚餐',start:'18:30',end:'21:00',deadline:'17:30',nextDay:false})
async function saveMeal() {
  if(!isChef.value)return
  const start=`${mealForm.date}T${mealForm.start}:00`;const ed=new Date(`${mealForm.date}T12:00:00`);if(mealForm.nextDay)ed.setDate(ed.getDate()+1)
  const end=`${dateKey(ed)}T${mealForm.end}:00`,deadline=`${mealForm.date}T${mealForm.deadline}:00`
  if(!mealForm.name.trim()||!Number.isFinite(+new Date(start))||+new Date(end)<=+new Date(start)||+new Date(deadline)>+new Date(start)||+new Date(deadline)<=now.value)return notify('请设置有效的未来餐次，截止时间应不晚于开餐时间，结束应晚于开始')
  if(state.meals.some(m=>m.kitchenId===kitchenId.value&&m.date===mealForm.date&&m.name===mealForm.name.trim()))return notify('当天已有同名餐次，请换一个名称')
  if(lanEnabled){const result=await sendShared({type:'meal.create',kitchenId:kitchenId.value,date:mealForm.date,name:mealForm.name,startsAt:start,endsAt:end,deadline});if(result){mealId.value=result.id;selectedDate.value=mealForm.date;modal.value='';notify('新餐次已开放')}return}
  const id=newId();state.meals.push({id,kitchenId:kitchenId.value,date:mealForm.date,name:mealForm.name.trim(),startsAt:start,endsAt:end,deadline,status:'open',portions:{}});mealId.value=id;selectedDate.value=mealForm.date;modal.value='';notify('新餐次已开放')
}
function editRecipe(r?:Recipe) {recipeDetail.value=null;editingRecipe.value=r?JSON.parse(JSON.stringify(r)):undefined;modal.value='recipe-edit'}
function safeSource(url:string) {try {return ['https:','http:'].includes(new URL(url).protocol)}catch{return false}}
async function toggleLibrary(r:Recipe) {
  if(!isChef.value||!kitchen.value)return notify('只有本厨房主厨可以调整自家菜单')
  if(sharedBusy.value)return
  const removing=kitchen.value.recipeIds.includes(r.id)
  if(lanEnabled){if(!await sendShared({type:removing?'recipe.remove':'recipe.add',kitchenId:kitchenId.value,recipeId:r.id}))return}
  else if(removing)kitchen.value.recipeIds=kitchen.value.recipeIds.filter(id=>id!==r.id)
  else kitchen.value.recipeIds.push(r.id)
  notify(removing?'已从我家菜单移除，历史用餐记录保留':'已加入我家菜单，可再修改成自己的口味')
}
autoEnter()

</script>

<template>
  <div class="demo-bar account-bar"><span class="demo-label"><span class="live-dot"></span>一餐 · 我们的小厨房<span class="desktop-only"> · 数据保存在本机</span></span><button class="account-bar-profile" @click="modal='account'" aria-label="打开账号设置"><span class="avatar small" :style="{background:people[person]?.color}">{{people[person]?.short}}</span><span>{{account?.nickname}}</span><ChevronDown :size="14"/></button></div>
  <div v-if="lanEnabled" class="sync-status" :class="{offline:sharedStatus==='offline'}"><span>{{sharedBusy?'正在保存…':sharedStatus==='online'?'已连接 · 厨房数据自动同步':'连接中断 · 请保持电脑服务运行，未确认的提交可重试'}}</span><button v-if="sharedStatus==='offline'" @click="shared.refresh()">重新连接</button></div>

  <div class="app-shell">
    <aside class="sidebar">
      <a class="brand" href="#" @click.prevent="chooser=true"><div class="brand-symbol"><CookingPot :size="25" :stroke-width="1.6"/></div><div><strong>一餐<span>YICAN</span></strong><small>好好吃饭，好好相伴</small></div></a>
      <button class="kitchen-switch" @click="chooser=true"><span class="kitchen-icon"><House :size="18"/></span><span><b>{{kitchen?.name||'选择我的厨房'}}</b><small>{{role ? identityLabel+(longRole?' · 长期成员':' · 单餐来客'):'让喜欢的人一起入座'}}</small></span><ChevronDown :size="16"/></button>
      <nav v-if="kitchen && !expired" class="main-nav" aria-label="主导航">
        <span class="nav-caption">我的厨房</span>
        <button v-if="isChef" :class="{active:page==='chef'}" @click="navigate('chef')"><ChefHat :size="19"/>今日厨房<span v-if="orderedRecipes.length" class="nav-number">{{orderedRecipes.length}}</span></button>
        <button :class="{active:page==='menu'}" @click="navigate('menu')"><Utensils :size="19"/>{{isChef?'我家菜单':'今天吃什么'}}</button>
        <button v-if="!isChef" :class="{active:page==='orders'}" @click="navigate('orders')"><ListChecks :size="19"/>我的点菜<span v-if="ownOrder" class="tiny-dot"></span></button>
        <button v-if="isChef" :class="{active:page==='shopping'}" @click="navigate('shopping')"><ShoppingBasket :size="19"/>备菜清单<span v-if="missingRows.length" class="nav-number">{{missingRows.length}}</span></button>
        <button v-if="isChef" :class="{active:page==='stock'}" @click="navigate('stock')"><Sprout :size="19"/>家中库存</button>
        <button v-if="longRole" :class="{active:page==='journal'}" @click="navigate('journal')"><BookHeart :size="19"/>用餐日志</button>
        <span class="nav-caption second">多一点生活灵感</span>
        <button v-if="longRole" :class="{active:page==='library'}" @click="navigate('library')"><BookOpen :size="19"/>发现菜谱<ArrowUpRight class="end-icon" :size="15"/></button>
        <button :class="{active:page==='settings'}" @click="navigate('settings')"><Settings2 :size="19"/>厨房设置</button>
      </nav>
      <div class="sidebar-bottom"><div class="side-note"><Leaf :size="24"/><p>平凡的日子，<br>也值得认真做一餐。</p><span>MADE WITH A LITTLE LOVE</span></div><button class="profile" @click="navigate('settings')"><span class="avatar" :style="{background:people[person].color}">{{people[person].short}}</span><span><b>{{people[person].name}}</b><small>{{role?identityLabel:'今天也要好好吃饭'}}</small></span><ChevronRight :size="15"/></button></div>
    </aside>

    <div class="workspace">
      <header class="topbar"><div class="breadcrumbs"><span>{{kitchen?.name||'欢迎来到一餐'}}</span><ChevronRight :size="13"/><b>{{({menu:isChef?'我家菜单':'今天吃什么',chef:'今日厨房',orders:'我的点菜',shopping:'备菜清单',stock:'家中库存',library:'发现菜谱',settings:'厨房设置',journal:'用餐日志'} as Record<string,string>)[page]}}</b></div><div class="top-actions"><button class="icon-btn review-entry" aria-label="餐后评价" title="餐后评价" @click="openReviews()"><Heart :size="17"/><span>评价</span></button><span class="date-caption">{{new Date(now).toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})}}</span><button v-if="canManage && !expired" class="btn btn-small secondary" @click="openInvite"><Users :size="15"/>邀请入座</button><button class="icon-btn mobile-switch" aria-label="切换厨房" @click="chooser=true"><House :size="20"/></button></div></header>
      <main>
        <section v-if="!kitchen || expired" class="welcome-empty"><div class="empty-mark"><CookingPot :size="44"/></div><span class="eyebrow">A TABLE FOR EVERYONE</span><h1>{{expired?'这一餐，感谢有你':'为喜欢的人，留一个位置'}}</h1><p>{{expired?'临时用餐身份已到期，无法继续点菜。历史点菜已留在主厨的餐次记录中。':'创建一个自己的厨房，或从朋友的邀请中加入。'}}</p><button class="btn primary" @click="expired?autoEnter():(createForm.name='',modal='create')">{{expired?'返回我的厨房':'创建我的厨房'}}<ArrowRight :size="17"/></button><button v-if="!expired&&ownKitchens.length" class="btn secondary" @click="chooser=true">选择已有厨房</button><form class="welcome-invite-form" @submit.prevent="enterInvite"><label class="form-field">已有邀请？<input v-model="inviteInput" required placeholder="粘贴邀请链接或邀请码" aria-label="邀请链接或邀请码"></label><button class="btn secondary full" type="submit">接受厨房邀请<ArrowRight :size="17"/></button><p v-if="inviteInputError" class="auth-error" role="alert">{{inviteInputError}}</p></form><button class="text-button welcome-account" @click="modal='account'">我的账号与登录设置</button></section>

        <template v-else>
          <section v-if="['menu','chef','orders','shopping'].includes(page)" class="meal-selector">
            <div class="date-section"><button v-if="longRole" class="calendar-trigger" @click="openCalendar" aria-label="选择日期和餐次"><span class="calendar-trigger-icon"><CalendarDays :size="22"/></span><span><small>用餐安排</small><b>{{dateText(selectedDate,true)}}<span v-if="meal"> · {{meal.name}}</span></b></span><ChevronDown :size="18"/></button><span v-else class="locked-date"><LockKeyhole :size="18"/>{{meal?dateText(meal.date,true)+' · '+meal.name:''}} · 仅受邀餐次</span><button v-if="isChef" class="icon-btn open-meal" aria-label="开启新餐次" @click="modal='meal'"><Plus :size="20"/></button></div>
            <div class="meal-options"><span v-if="meal" class="meal-deadline"><span class="status-dot" :class="{closed:!canSubmit}"></span>{{now>=+new Date(meal.endsAt)?'用餐时间已结束':meal.status==='open'&&!canSubmit?'已截止点菜':statusNames[meal.status]}}<span class="divider">/</span>{{timeText(meal.deadline)}} 截止点菜</span><button v-if="longRole" class="text-button" @click="openCalendar">查看月历<ChevronRight :size="14"/></button></div>

          </section>

          <nav v-if="longRole&&['chef','menu','library'].includes(page)" class="mobile-recipe-nav" aria-label="菜谱与菜单">
            <button :class="{active:page==='menu'}" :aria-current="page==='menu'?'page':undefined" @click="navigate('menu')"><span class="recipe-nav-icon"><Utensils :size="20"/></span><span><b>{{isChef?'自家菜单':'今天吃什么'}}</b><small>{{menuRecipes.length}} 道餐桌好味</small></span></button>
            <button :class="{active:page==='library'}" :aria-current="page==='library'?'page':undefined" @click="navigate('library')"><span class="recipe-nav-icon"><BookOpen :size="20"/></span><span><b>发现菜谱</b><small>{{publicRecipes.length}} 道做饭灵感</small></span></button>
          </nav>
          <button v-if="meal&&['orders','chef'].includes(page)&&canReviewMeal(state,person,meal,now)" class="review-invitation" @click="openReviews()"><span class="review-heart"><Heart :size="22"/></span><span><b>{{isChef?'这一餐，收到了哪些喜欢？':'吃得开心，就留一句喜欢。'}}</b><small>{{isChef?'看看家人的餐后评价':'评价整餐或某道菜，把心意留给主厨'}}</small></span><ChevronRight :size="20"/></button>
          <template v-if="page==='menu'||page==='library'">
            <section v-if="page==='library'||isChef" class="hero" :class="{library:page==='library'}"><div class="hero-copy"><span class="eyebrow">{{page==='library'?'A LITTLE INSPIRATION':'OUR EVERYDAY TABLE'}}</span><h1>{{page==='library'?'把新滋味，带回家。':'拿手的味道，等你开火。'}}</h1><p>{{page==='library'?'从一份好菜谱开始，慢慢做成自己的拿手菜。':kitchen.subtitle}}</p><div class="hero-foot"><span class="small-avatars"><span v-for="p in kitchenAvatars" :key="p.id" :style="{background:p.color}">{{p.short}}</span></span><span>{{kitchen.chefId?`${people[kitchen.chefId]?.name}的厨房`:'等待主厨加入'}}<b> · {{page==='library'?baseRecipes.length+' 道精选灵感':menuRecipes.length+' 道家常味道'}}</b></span></div></div><div class="hero-art"><div class="hero-orbit"></div><FoodArt kind="tomato"/><span class="herb-stamp"><Sprout :size="26"/><small>一餐一味</small></span></div></section>
            <div class="menu-layout" :class="{'no-cart':page==='library'}"><section class="menu-main"><div class="section-heading"><div><span class="eyebrow">{{page==='library'?'RECIPE COLLECTION':'THE MENU'}}</span><h2 v-if="page==='library'||isChef">{{page==='library'?'发现下一道拿手菜':'自家菜单'}}</h2></div><button v-if="isChef&&page==='menu'" class="btn secondary btn-small" @click="editRecipe()"><Plus :size="16"/>添加菜品</button><span v-else class="section-hint">{{displayRecipes.length}} 道菜</span></div><div class="menu-tools"><label class="search-field"><Search :size="17"/><input v-model="search" aria-label="搜索菜名或食材" placeholder="搜一道菜，或一种食材"></label></div>
            <div class="menu-browser"><nav class="category-rail" aria-label="菜品分类"><button v-for="c in categories" :key="c" :class="{active:category===c}" :aria-pressed="category===c" @click="selectCategory(c)"><ChefHat v-if="c==='主厨拿手'" :size="17"/><Heart v-else-if="c==='我的爱吃'" :size="17"/><span>{{c}}</span><small>{{categoryCount(c)}}</small></button></nav><div ref="menuResults" class="menu-results"><div class="result-heading"><b>{{category}}</b><span>{{displayRecipes.length}} 道菜</span></div><div class="dish-grid"><article class="dish-card" v-for="r in displayRecipes" :key="r.id"><button class="dish-picture" :class="r.art" @click="recipeDetail=r" :aria-label="'查看'+r.name+'菜谱'"><FoodArt :kind="r.art" :reference="coverIsReference(r)" :alt="r.name+'封面'"/><span v-if="r.minutes!=null&&r.minutes<=15" class="quick-tag"><Clock3 :size="12"/>快手菜</span></button><div class="dish-body"><button class="dish-title" @click="recipeDetail=r">{{r.name}}</button><p>{{r.note}}</p><div class="recipe-marks"><button v-if="isChef&&page==='menu'" class="mark-button" :class="{marked:signatureIds.includes(r.id)}" :aria-pressed="signatureIds.includes(r.id)" :aria-label="(signatureIds.includes(r.id)?'取消拿手菜':'标记拿手菜')+r.name" @click="markRecipe(r,'signature')"><ChefHat :size="16"/><span>{{signatureIds.includes(r.id)?'拿手菜':'设为拿手'}}</span></button><span v-else-if="signatureIds.includes(r.id)" class="signature-badge"><ChefHat :size="14"/>拿手菜</span><button class="mark-button" :class="{marked:favoriteIds.includes(r.id)}" :aria-pressed="favoriteIds.includes(r.id)" :aria-label="(favoriteIds.includes(r.id)?'取消爱吃':'标记爱吃')+r.name" @click="markRecipe(r,'favorite')"><Heart :size="16" :fill="favoriteIds.includes(r.id)?'currentColor':'none'"/><span>{{favoriteIds.includes(r.id)?'爱吃':'想常吃'}}</span></button></div><div class="dish-bottom"><span><Clock3 :size="13"/>{{r.minutes==null?'时长待补充':r.minutes+'分钟'}}<span class="mid-dot">·</span>{{r.servings==null?'人数待补充':r.servings+'人参考量'}}</span><button v-if="page==='library'" class="add-button" :class="{added:kitchen.recipeIds.includes(r.id)}" :aria-pressed="kitchen.recipeIds.includes(r.id)" :disabled="sharedBusy" :aria-label="kitchen.recipeIds.includes(r.id)?'将'+r.name+'移出菜单':'将'+r.name+'加入菜单'" :title="kitchen.recipeIds.includes(r.id)?'点击移出我家菜单':'加入我家菜单'" @click="toggleLibrary(r)"><Check v-if="kitchen.recipeIds.includes(r.id)" :size="18"/><Plus v-else :size="18"/></button><button v-else-if="isChef" class="add-button neutral" :aria-label="'编辑'+r.name" @click="editRecipe(r)"><Pencil :size="15"/></button><button v-if="page!=='library'" class="add-button" :class="{added:chosen.includes(r.id)}" :disabled="!canSubmit" :aria-label="(chosen.includes(r.id)?'取消选择':'想吃')+r.name" @click="toggleDish(r.id)"><Check v-if="chosen.includes(r.id)" :size="18"/><Plus v-else :size="18"/></button></div></div></article></div><div v-if="!displayRecipes.length" class="empty-small"><Search :size="28"/><p>{{category==='主厨拿手'?'还没有拿手菜，主厨可以在菜单中标记。':category==='我的爱吃'?'还没有收藏，点击菜品上的心形记下爱吃的菜。':'没有找到这道菜，换个关键词试试。'}}</p></div><p class="quiet-note"><Leaf :size="13"/>{{page==='library'?'菜谱来源见详情末尾；标有“仅供参考”的封面为替代图或示意图，用量请结合原文确认。':'一份菜单，一点偏爱。每道菜都可以查看食材和参考做法。'}}</p></div></div></section>
</div>
            <button v-if="page==='menu'" class="mobile-cart-shortcut" aria-label="打开购物车" aria-haspopup="dialog" :aria-expanded="modal==='cart'" @click="showCart"><ShoppingBasket :size="21"/><span>{{chosen.length?'已选 '+chosen.length+' 道菜':'这一餐，想吃什么？'}}</span><b>查看购物车<ChevronRight :size="16"/></b></button>
          </template>

          <template v-else-if="page==='chef'">
            <div class="section-heading page-heading"><div><span class="eyebrow">A MEAL MADE WITH LOVE</span><h1>有人在期待你的拿手菜。</h1><p>{{orders.length}} 位家人已点菜 · {{orderedRecipes.length}} 道想吃的菜</p></div><button class="btn secondary" @click="navigate('menu')"><Plus :size="16"/>为自己加菜</button></div>
            <div class="chef-layout"><section><div class="panel-head"><h2>{{meal?.name||'还没有餐次'}}的菜单</h2><span class="badge soft">{{meal?statusNames[meal.status]:''}}</span></div><div v-if="!orderedRecipes.length" class="empty-small surface"><CookingPot :size="40"/><h3>这一餐还在等灵感</h3><p>邀请家人点菜，或者先添加自己的拿手菜。</p><button class="btn secondary" @click="openInvite">邀请入座</button></div><article class="chef-dish" v-for="r in orderedRecipes" :key="r.id"><button class="chef-food" @click="recipeDetail=r" :aria-label="'参考菜谱'+r.name"><FoodArt :kind="r.art" :reference="coverIsReference(r)" :alt="r.name+'封面'"/></button><div class="chef-dish-info"><button class="dish-title" @click="recipeDetail=r">{{r.name}}<ArrowUpRight :size="14"/></button><p>{{orders.filter(o=>o.recipeIds.includes(r.id)).map(o=>people[o.userId]?.name||'家人').join('、')}} 想吃</p><span class="muted">{{r.servings==null?'人数待补充':'1份约'+r.servings+'人参考量'}} · {{r.minutes==null?'时长待补充':r.minutes+'分钟'}}</span></div><div class="portion"><small>实际做几份</small><div class="stepper"><button :disabled="!meal||['done','cancelled'].includes(meal.status)||(meal.portions[r.id]??1)<=0" :aria-label="'减少'+r.name+'份数'" @click="setPortion(r.id,-1)"><Minus :size="15"/></button><b>{{meal?.portions[r.id]??1}}</b><button :disabled="!meal||['done','cancelled'].includes(meal.status)" :aria-label="'增加'+r.name+'份数'" @click="setPortion(r.id,1)"><Plus :size="15"/></button></div></div></article><div class="notes-panel" v-if="orders.some(o=>o.note)"><h3><MessageCircle :size="17"/>留给你的话</h3><p v-for="o in orders.filter(o=>o.note)" :key="o.id"><b>{{people[o.userId]?.name}}</b>“{{o.note}}”</p></div></section><aside class="prep-card"><span class="prep-icon"><ShoppingBasket :size="30" :stroke-width="1.5"/></span><span class="eyebrow">READY FOR THE KITCHEN</span><h2>开火前，心里有数。</h2><p>食材已按这餐的菜品合并，<br>也帮你看过家里的库存了。</p><div class="prep-stats"><div><b>{{rows.length}}</b><span>种食材</span></div><div><b>{{missingRows.length}}</b><span>项需准备 / 确认</span></div></div><button class="btn secondary full" @click="navigate('shopping')">查看备菜清单<ArrowRight :size="16"/></button><button v-if="meal&&meal.status!=='done'&&meal.status!=='cancelled'" class="btn primary full" @click="updateStatus">{{meal.status==='open'?'确认菜单，开始备菜':meal.status==='prep'?'食材就绪，开始做饭':'完成这一餐'}}<Check :size="16"/></button><p class="small-note">确认备菜后，本餐停止接收新点菜。<br>调整份数会重新计算食材。</p></aside></div>
          </template>

          <template v-else-if="page==='orders'">
            <div class="section-heading page-heading"><div><span class="eyebrow">A LITTLE ANTICIPATION</span><h1>点好菜，等一顿好饭。</h1><p>这一餐的期待，都放在这里。</p></div></div><section v-if="ownOrder" class="order-card surface"><div class="panel-head"><div><span class="badge soft">{{meal?statusNames[meal.status]:''}}</span><h2>{{meal?dateText(meal.date,true)+' · '+meal.name:''}}</h2></div><CheckCircle2 class="green" :size="30"/></div><div class="order-dishes"><button v-for="id in ownOrder.recipeIds" :key="id" @click="recipeDetail=state.recipes.find(r=>r.id===id)||null"><FoodArt :kind="state.recipes.find(r=>r.id===id)?.art"/><b>{{state.recipes.find(r=>r.id===id)?.name}}</b></button></div><p v-if="ownOrder.note" class="order-note">你的留言：{{ownOrder.note}}</p><div class="order-footer"><span class="muted">提交于 {{new Date(ownOrder.createdAt).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}}</span><div><button class="text-button" :disabled="!canSubmit" @click="cancelOrder">撤回点菜</button><button class="btn secondary btn-small" :disabled="!canSubmit" @click="editOrder">修改这一餐</button></div></div></section><div v-else class="empty-small surface"><Utensils :size="38"/><h3>这餐还没选好呢</h3><p>去看看主厨准备了什么拿手菜。</p><button class="btn primary" @click="navigate('menu')">去选菜<ArrowRight :size="16"/></button></div>
          </template>

          <template v-else-if="page==='shopping'&&isChef">
            <div class="section-heading page-heading"><div><span class="eyebrow">A THOUGHTFUL SHOPPING LIST</span><h1>少一点遗漏，多一点从容。</h1><p>同类食材已合并；勾选表示这一餐已备齐，不会直接扣减库存。</p></div><button class="btn secondary" @click="navigate('stock')"><SlidersHorizontal :size="16"/>管理库存</button></div><div class="shopping-summary"><span class="summary-icon"><ShoppingBasket :size="24"/></span><div><b>{{rows.length-missingRows.length}} / {{rows.length}} 项已备齐</b><span>{{meal?.status==='open'?'预估清单 · 待主厨确认份数':'本餐清单'}} · 还需准备或确认 {{missingRows.length}} 项</span></div><div class="progress-track"><i :style="{width:rows.length?`${(rows.length-missingRows.length)/rows.length*100}%`:'0%'}"></i></div></div><div class="list-toolbar"><div class="pill-tabs"><button :class="{active:listFilter==='all'}" @click="listFilter='all'">全部食材 {{rows.length}}</button><button :class="{active:listFilter==='missing'}" @click="listFilter='missing'">只看待准备 {{missingRows.length}}</button></div><span class="muted">库存匹配当前数量</span></div><section class="shopping-list"><article v-for="r in shownRows" :key="r.key" class="shopping-row" :class="{prepared:isPrepared(state,mealId,r)}"><label class="check-wrap"><input type="checkbox" :checked="isPrepared(state,mealId,r)" :aria-label="r.name+'已备齐'" @change="checkRow(r)"><span class="check-visual"><Check :size="15"/></span></label><div class="ingredient-name"><b>{{r.name}}</b><span>{{r.sources.map(s=>s.name+' '+qty(s.amount,r.unit)).join(' · ')}}</span></div><div class="ingredient-amount"><b>需要 {{qty(r.amount,r.unit)}}</b><span>库存 {{r.available===null?'数量 / 单位待确认':qty(r.available,r.unit)}}</span></div><span class="ingredient-status" :class="isPrepared(state,mealId,r)?'green':r.status==='unknown'?'amber':'red'">{{isPrepared(state,mealId,r)?'已备齐':r.status==='enough'?'待备齐确认':r.status==='unknown'?'请核实数量':'还缺 '+qty(r.shortage,r.unit)}}</span></article><div v-if="!shownRows.length" class="empty-small"><CheckCheck :size="36"/><h3>{{rows.length?'这一餐，都准备好了':'还没有要准备的食材'}}</h3><p>{{rows.length?'安心开火，慢慢享受做饭吧。':'主厨确认菜品后，在这里查看食材。'}}</p></div></section><p class="quiet-note"><CircleHelp :size="14"/>“个”和“克”不会自动换算；数量不明的库存需要确认，避免少买。</p>
          </template>

          <template v-else-if="page==='stock'&&isChef">
            <div class="section-heading page-heading"><div><span class="eyebrow">ALREADY AT HOME</span><h1>家里有什么，一眼就知道。</h1><p>记下冰箱里的新鲜，也记下调料架上的常备。</p></div><div class="stock-entry-actions"><button class="btn secondary" @click="modal='stock-text'"><ListChecks :size="17"/>文字录入</button><button class="btn primary" @click="editStock()"><Plus :size="17"/>逐项添加</button></div></div><div class="pantry-banner"><Sprout :size="33"/><div><h3>给已有的食材，多一次上桌的机会。</h3><p>备菜勾选只记录已备齐，不会扣减库存；数量待确认的库存也不会自动变成用光。</p></div></div><div class="pill-tabs inventory-tabs"><button :class="{active:stockType==='all'}" @click="stockType='all'">全部</button><button :class="{active:stockType==='food'}" @click="stockType='food'">新鲜食材</button><button :class="{active:stockType==='seasoning'}" @click="stockType='seasoning'">常备调料</button></div><div class="inventory-grid"><article v-for="s in inventory" :key="s.id" class="stock-card"><div class="stock-top"><span class="stock-icon"><Sprout v-if="s.type==='food'" :size="23"/><CookingPot v-else :size="23"/></span><button class="icon-btn" :aria-label="'修改库存'+s.name" @click="editStock(s.id)"><Pencil :size="15"/></button></div><h3>{{s.name}}</h3><p :class="{red:s.amount===0,amber:s.amount===null}">{{stockText(s)}}</p><div class="stock-bottom"><span>{{s.type==='food'?'新鲜食材':'常备调料'}}</span><button class="text-button" :disabled="s.amount===0||s.amount===null" :title="s.amount===null?'请先填写库存数量':''" @click="useUp(s.id)">{{s.amount===null?'先填数量':'用完了'}}</button></div></article><button class="stock-card add-stock" @click="editStock()"><Plus :size="25"/><span>再记一样</span></button></div>
          </template>

          <MealJournal v-else-if="page==='journal'&&longRole" :state="state" :kitchen-id="kitchenId" :person="person" :now="now" @recipe="recipeDetail=$event" @review="openJournalReviews"/>

          <template v-else-if="page==='settings'">
            <div class="section-heading page-heading"><div><span class="eyebrow">KITCHEN SETTINGS</span><h1>小厨房管理处</h1><p>调整厨房信息，看看一起吃饭的人。</p></div></div><div class="settings-grid"><section class="surface settings-card"><h2><House :size="21"/>厨房与成员</h2><button v-if="canManage" class="setting-row clickable kitchen-name-setting" aria-label="修改厨房名称" @click="modal='rename'"><span>厨房名称<b>{{kitchen.name}}</b><small>两位主人可共同修改</small></span><span class="kitchen-name-edit"><Pencil :size="15"/>修改<ChevronRight :size="16"/></span></button><div v-else class="setting-row"><span>厨房名称<b>{{kitchen.name}}</b><small>仅厨房主人可修改</small></span></div><div class="setting-row"><span>角色称谓<b>{{kitchen.chefLabel}} / {{kitchen.dinerLabel}}</b></span><button v-if="canManage" class="text-button" @click="openNaming">自定义</button></div><div class="setting-row"><span>我的身份<b>{{identityLabel}} · {{longRole?'长期成员':'临时成员'}}</b></span><span class="badge soft">{{longRole?'长期有效':'本餐结束失效'}}</span></div><button v-if="isChef" class="setting-row clickable" @click="navigate('menu')"><span>管理自家菜单<b>把菜谱调整成我家的味道</b><small>菜名、封面、食材用量与做法</small></span><BookOpen :size="19"/></button><button v-if="longRole" class="setting-row clickable" @click="navigate('library')"><span>发现菜谱<b>为餐桌添一点新灵感</b></span><ChevronRight :size="19"/></button><button class="setting-row clickable" @click="modal='kitchen-manage'"><span>厨房与成员管理<b>一起吃饭的人与邀请</b><small>{{canManage?'成员、邀请、交接与解散':'查看成员与退出厨房'}}</small></span><ChevronRight :size="19"/></button></section><section class="surface settings-card"><h2><Heart :size="21"/>账号与偏好</h2><button class="setting-row clickable" @click="modal='account'"><span>我的账号<b>{{account?.nickname}} · {{account?.username}}</b><small>{{account?.passwordless?'免密码模式':'密码保护'}} · 修改密码与登录方式</small></span><KeyRound :size="19"/></button><button class="setting-row clickable theme-setting" aria-label="更换主题颜色" @click="modal='theme'"><span>主题颜色<b>{{currentTheme.name}}</b><small>换一种喜欢的日常色调</small></span><span class="theme-setting-end"><i :style="{background:currentTheme.colors.accent}"></i><i :style="{background:currentTheme.colors.companion}"></i><ChevronRight :size="19"/></span></button><button v-if="longRole" class="setting-row clickable" @click="navigate('journal')"><span>用餐日志<b>回看一餐一饭的烟火</b></span><BookHeart :size="19"/></button><button class="setting-row clickable" @click="modal='feedback'"><span>建议与问题反馈<b>提建议、反馈使用中的问题</b><small>先检查连接，再选择反馈方式</small></span><MessageCircle :size="19"/></button><button class="setting-row clickable" @click="modal='feedback-history'"><span>我的反馈记录<b>{{state.feedback.length}} 条{{lanEnabled?'共享记录':'本机记录'}}</b></span><ChevronRight :size="19"/></button><div class="setting-row"><span>隐私与数据<b>{{lanEnabled?'数据保存在电脑共享数据库':'体验数据保存在本浏览器'}}</b></span><LockKeyhole :size="18"/></div><p class="small-note">{{lanEnabled?'账号与厨房数据保存在本机数据库。邀请好友注册后加入厨房，一起点菜、备菜和记录日常。':'当前为交互Demo。邀请仅用于本机模拟，反馈不会发送到开发者；未接入微信登录、支付与通知。'}}</p></section></div>
          </template>
        </template>
      </main>
      <footer class="app-footer"><CookingPot :size="15"/><span>一餐 · 把日子过成喜欢的味道</span><span class="footer-right">愿每次开火，都有人期待。</span></footer>
    </div>
  </div>

  <nav v-if="kitchen&&!expired" class="mobile-nav" aria-label="手机导航"><button :class="{active:page===(isChef?'chef':'menu')}" @click="navigate(isChef?'chef':'menu')"><CookingPot :size="21"/>{{isChef?'厨房':'点菜'}}</button><button :class="{active:page===(isChef?'shopping':'orders')}" @click="navigate(isChef?'shopping':'orders')"><ListChecks :size="21"/>{{isChef?'备菜':'已点'}}</button><button :class="{active:page===(isChef?'stock':'library')}" @click="navigate(isChef?'stock':'library')"><Sprout :size="21"/>{{isChef?'库存':'发现菜谱'}}</button><button v-if="longRole" :class="{active:page==='journal'}" @click="navigate('journal')"><BookHeart :size="21"/>日志</button><button :class="{active:page==='settings'}" @click="navigate('settings')"><Settings2 :size="21"/>我的</button></nav>

  <Modal v-if="chooser" title="今天，在哪间厨房吃饭？" @close="chooser=false"><p class="modal-intro">每间厨房，都有不一样的烟火气。</p><button v-for="k in ownKitchens" :key="k.id" class="kitchen-choice" @click="chooseKitchen(k.id)"><span class="choice-house"><House :size="25"/></span><span><b>{{k.name}}</b><small>{{k.subtitle}}</small><em>{{memberRole(state,person,k.id)==='chef'?k.chefLabel:isKitchenHost(state,person,k)?'点菜主人':'客人'}} · {{memberRole(state,person,k.id)?'长期成员':'单餐来客'}}</em></span><ArrowRight :size="20"/></button><p v-if="!ownKitchens.length" class="empty-small">还没有有效的厨房身份，创建一个或接受朋友的邀请吧。</p><button class="btn secondary full" @click="chooser=false;createForm.name='';modal='create'"><Plus :size="17"/>创建另一间厨房</button><form class="welcome-invite-form" @submit.prevent="enterInvite"><label class="form-field">加入朋友的厨房<input v-model="inviteInput" required placeholder="粘贴邀请链接或邀请码" aria-label="邀请链接或邀请码"></label><button class="btn secondary full" type="submit">接受邀请</button><p v-if="inviteInputError" class="auth-error">{{inviteInputError}}</p></form></Modal>
  <Modal v-if="recipeDetail" :title="recipeDetail.name" wide @close="recipeDetail=null"><div class="recipe-modal"><div class="recipe-visual"><FoodArt :kind="recipeDetail.art" :reference="coverIsReference(recipeDetail)" :alt="recipeDetail.name+'封面'"/></div><div><p class="recipe-description">{{recipeDetail.note}}</p><div class="recipe-meta"><span><Clock3 :size="15"/>{{recipeDetail.minutes==null?'时长待补充':recipeDetail.minutes+'分钟'}}</span><span><Users :size="15"/>{{recipeDetail.servings==null?'人数待补充':recipeDetail.servings+'人参考量'}}</span></div><h3>准备这些食材</h3><div class="recipe-ingredients"><div v-for="(i,index) in recipeDetail.ingredients" :key="index"><span>{{i.name}}</span><b>{{qty(i.amount,i.unit)}}</b></div></div></div></div><details v-if="recipeDetail.sourceText" class="source-original"><summary>查看完整原菜谱（用量、版本与补充说明）</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;line-height:1.8">{{recipeDetail.sourceText}}</pre></details><h3 class="steps-heading">一步一步，慢慢来</h3><p v-if="!recipeDetail.steps.length" class="small-note">做法待补充</p><ol v-else class="steps"><li v-for="(step,i) in recipeDetail.steps" :key="i"><span>{{String(i+1).padStart(2,'0')}}</span><p>{{step}}</p></li></ol><a v-if="recipeDetail.source&&safeSource(recipeDetail.source)" :href="recipeDetail.source" target="_blank" rel="noopener noreferrer" class="source-link"><Link :size="16"/>查看原始教程<ArrowUpRight :size="16"/></a><p v-else-if="recipeDetail.steps.length" class="small-note">暂无原教程链接；份量可按口味调整。</p><button v-if="isChef&&(kitchen?.recipeIds.includes(recipeDetail.id)||!recipeDetail.id.startsWith('private-'))" class="btn secondary full" @click="editRecipe(recipeDetail)"><Pencil :size="15"/>保存成我家的做法</button><section class="recipe-review-section"><div class="review-target-heading"><h3>关于这道菜的喜欢 <small>{{detailReviews.length}}</small></h3><button class="text-button" @click="reviewDish(recipeDetail!)">写下感受<Heart :size="15"/></button></div><ReviewFeed :reviews="detailReviews" :state="state" :person="person"/><p v-if="!detailReviews.length" class="review-privacy">还没有餐后评价，尝过以后来留一句吧。</p></section><p v-if="recipeOriginUrl(recipeDetail)" class="recipe-attribution"><BookOpen :size="13"/><span>菜谱来源于 <a :href="recipeOriginUrl(recipeDetail)!" target="_blank" rel="noopener noreferrer">HowToCook 开源库<ArrowUpRight :size="12"/></a></span></p></Modal>


<Modal v-if="modal==='cart'&&kitchen&&!expired" title="这一餐的购物车" sheet @close="modal=''">            <div class="cart cart-panel" id="meal-cart"><div class="cart-heading"><div><span class="eyebrow">YOUR PICKS</span><h3>这一餐，想吃这些</h3></div><span class="count-bubble">{{chosen.length}}</span></div><p class="cart-date">{{meal?dateText(meal.date)+' · '+meal.name:'请先选择餐次'}}</p><div v-if="!chosen.length" class="cart-empty"><ShoppingBasket :size="34" :stroke-width="1.2"/><p>把想吃的，放进来。</p><small>点击菜品旁的 ＋ 开始选菜</small></div><div v-for="r in selectedRecipes" :key="r.id" class="cart-item"><div class="mini-food"><FoodArt :kind="r.art" :reference="coverIsReference(r)" :alt="r.name+'封面'"/></div><span><b>{{r.name}}</b><small>想吃这道菜</small></span><button class="icon-btn" :aria-label="'从待选移除'+r.name" @click="toggleDish(r.id)"><X :size="15"/></button></div><label class="cart-note">给{{kitchen.chefLabel}}留句话<textarea v-model="note" rows="2" maxlength="150" placeholder="少一点辣，多一点汤汁…"></textarea></label></div><template #footer><div class="cart-submit"><div class="cart-explain"><Heart :size="14"/><span>选的是心意，实际份量由{{kitchen.chefLabel}}确认。</span></div><button class="btn primary full" :disabled="!canSubmit||!chosen.length" @click="submitOrder">{{ownOrder?'更新我的点菜':'就吃这些'}}<ArrowRight :size="17"/></button><button v-if="ownOrder" class="text-button full" @click="editOrder">查看并修改已提交的点菜</button></div></template></Modal>
  <Modal v-if="modal==='calendar'" title="哪一天，一起吃？" @close="modal=''">
    <div class="calendar-month"><button class="icon-btn" aria-label="上个月" @click="moveMonth(-1)"><ChevronLeft :size="21"/></button><h3>{{calendarHeading}}</h3><button class="icon-btn" aria-label="下个月" @click="moveMonth(1)"><ChevronRight :size="21"/></button></div>
    <div class="calendar-week"><span v-for="d in ['一','二','三','四','五','六','日']" :key="d">{{d}}</span></div>
    <div class="calendar-grid"><template v-for="(d,i) in calendarCells" :key="d||'blank-'+i"><button v-if="d" :disabled="!dates.includes(d)" :class="{selected:calendarDate===d,today:d===dateKey(new Date(now))}" :aria-label="calendarLabel(d)" :aria-pressed="calendarDate===d" @click="calendarDate=d"><span>{{Number(d.slice(-2))}}</span><span class="calendar-dots"><i v-if="orderMark(d).mine" class="mine"></i><i v-if="orderMark(d).others" class="others"></i></span></button><span v-else></span></template></div>
    <div class="calendar-legend"><span><i class="mine"></i>我已点</span><span><i class="others"></i>有人点</span><span>浅灰日期未开放</span></div>
    <div class="calendar-meals"><h3>{{dateText(calendarDate)}} · 选择餐次</h3><button v-for="m in calendarMeals" :key="m.id" :aria-label="'选择'+m.name+' '+timeText(m.startsAt)" :class="{selected:mealId===m.id}" @click="confirmMeal(m)"><span><b>{{m.name}}<small>{{timeText(m.startsAt)}}</small></b><small>{{state.orders.filter(o=>o.mealId===m.id).length}} 人已点 · {{now>=+new Date(m.endsAt)?'已结束':canOrder(state,person,m,now)?'可点菜':'已截止点菜'}}</small></span><Check v-if="mealId===m.id" :size="20"/><ChevronRight v-else :size="20"/></button><p v-if="!calendarMeals.length" class="muted">当天还没有开放餐次。</p></div>
  </Modal>
  <Modal v-if="modal==='invite'" title="给喜欢的人，留个位置" @close="modal=''"><p class="modal-intro">邀请加入 {{kitchen?.name}}，一起决定吃什么。</p><template v-if="!generated"><div class="invite-type"><button :disabled="!invitableMeals.length" :class="{selected:inviteType==='temporary'}" @click="inviteType='temporary'"><Utensils :size="23"/><b>这一餐相聚</b><small>{{invitableMeals.length?'锁定餐次，餐后身份失效':'先开启餐次，再邀请来客'}}</small></button><button :class="{selected:inviteType==='long'}" @click="inviteType='long'"><House :size="23"/><b>以后都一起吃</b><small>邀请主厨、点菜主人或客人</small></button></div><label v-if="inviteType==='temporary'" class="form-field">选择邀请餐次<select v-model="inviteMeal"><option v-for="m in invitableMeals" :key="m.id" :value="m.id">{{dateText(m.date)}} · {{m.name}} {{timeText(m.startsAt)}}—{{timeText(m.endsAt)}}</option></select></label><p class="inline-info"><LockKeyhole :size="16"/>{{inviteType==='temporary'?'朋友只能为指定餐次点菜，餐次结束自动退出。':'长期成员可选择厨房开放的日期和餐次。'}}</p><button class="btn primary full" @click="generateInvite">生成邀请<ArrowRight :size="17"/></button></template><template v-else><div class="invitation-card"><Sprout :size="32"/><span class="eyebrow">YOU ARE INVITED</span><h2>来我家，好好吃一餐。</h2><p>{{kitchen?.name}}</p><b>{{generated.type==='temporary'?dateText(state.meals.find(m=>m.id===generated!.mealId)!.date,true)+' · '+state.meals.find(m=>m.id===generated!.mealId)!.name:'成为我们的长期饭搭子'}}</b><small v-if="generated.type==='temporary'">{{timeText(state.meals.find(m=>m.id===generated!.mealId)!.startsAt)}} 开餐 · {{timeText(generated.expiresAt)}} 临时身份到期</small></div><p class="inline-info"><Users :size="17"/>把链接发给朋友，对方可注册或登录后选择身份入座。主厨和点菜主人各一位，其他成员为客人。</p><label class="form-field">{{lanEnabled?'局域网邀请链接':'本机演示邀请链接'}}<input :value="shareUrl" readonly aria-label="邀请链接"></label><button class="btn secondary full" @click="copyLink"><Copy :size="16"/>复制邀请链接</button><p class="small-note">分享给局域网好友时，请使用电脑的局域网地址打开页面后生成链接；127.0.0.1 链接仅当前设备可用。</p></template></Modal>
  <Modal v-if="modal==='stock'" :title="stockForm.id?'更新家中库存':'再记一样食材'" @close="modal=''"><form @submit.prevent="saveStock"><label class="form-field">名称<input v-model="stockForm.name" required maxlength="24" placeholder="例如：番茄"></label><div class="form-grid"><label class="form-field">数量<input v-model="stockForm.amount" type="number" min="0" step="0.1" placeholder="不确定可留空"></label><label class="form-field">单位<select v-model="stockForm.unit"><option v-if="!stockUnits.includes(stockForm.unit)" :value="stockForm.unit">{{stockForm.unit}}</option><option v-for="unit in stockUnits" :key="unit">{{unit}}</option></select></label></div><label class="form-field">分类<select v-model="stockForm.type"><option value="food">食材</option><option value="seasoning">调料</option></select></label><p class="small-note">数量留空表示“有，但多少待确认”，不会自动判断够用。</p><button class="btn primary full" type="submit">保存库存<Check :size="17"/></button></form></Modal>
  <KitchenNameEditor v-if="modal==='rename'&&kitchen&&longRole" :name="kitchen.name" :save="renameKitchen" @close="modal=''"/>
  <Modal v-if="modal==='naming'" title="自定义角色称谓" @close="modal=''"><form @submit.prevent="saveNaming"><div class="form-grid"><label class="form-field">主厨称谓<input v-model="naming.chefLabel" maxlength="8" required></label><label class="form-field">用餐角色称谓<input v-model="naming.dinerLabel" maxlength="8" required></label></div><p class="inline-info"><CircleHelp :size="16"/>称谓在本厨房统一展示，不改变角色权限。</p><button class="btn primary full" type="submit">保存称呼<Check :size="17"/></button></form></Modal>
  <Modal v-if="modal==='create'" title="让小厨房，有个新名字" @close="modal=''"><form @submit.prevent="createKitchen"><label class="form-field">厨房名称<input v-model="createForm.name" maxlength="18" placeholder="例如：我们的晚饭小屋" required></label><label class="form-field">我在厨房的身份<select v-model="createForm.role"><option value="chef">主厨 · 维护菜单与准备食材</option><option value="diner">点菜主人 · 一起管理厨房</option></select></label><p class="small-note">选择食客后，厨房会等待主厨加入，再开启点菜。</p><button class="btn primary full" type="submit">创建厨房<ArrowRight :size="17"/></button></form></Modal>
  <Modal v-if="modal==='meal'" title="开启一餐新的期待" @close="modal=''"><form @submit.prevent="saveMeal"><div class="form-grid"><label class="form-field">用餐日期<input v-model="mealForm.date" type="date" required></label><label class="form-field">餐次名称<input v-model="mealForm.name" maxlength="16" required placeholder="晚餐 / 朋友聚餐"></label></div><div class="form-grid"><label class="form-field">用餐开始<input v-model="mealForm.start" type="time" required></label><label class="form-field">用餐结束<input v-model="mealForm.end" type="time" required></label></div><label class="native-check"><input type="checkbox" v-model="mealForm.nextDay">结束时间在次日（跨午夜）</label><label class="form-field">点菜截止<input v-model="mealForm.deadline" type="time" required></label><p class="inline-info"><Clock3 :size="16"/>点菜截止后停止下单；用餐结束后，临时身份自动失效。</p><button class="btn primary full" type="submit">开放这一餐<Check :size="17"/></button></form></Modal>
  <RecipeEditor v-if="modal==='recipe-edit'&&isChef&&kitchen" :recipe="editingRecipe" :kitchen-id="kitchenId" :menu-ids="kitchen.recipeIds" :categories="recipeCategories" :send="sendManagement" @close="modal=''" @saved="modal='';notify('菜单已更新，历史订单保留原版')"/>
  <KitchenManagement v-if="modal==='kitchen-manage'&&kitchen" :state="state" :kitchen-id="kitchenId" :person="person" :now="now" :send="sendManagement" @close="modal=''" @left="leftKitchen" @invite="openInvite"/>
  <FeedbackGateway v-if="modal==='feedback'" @close="modal=''"/>
  <Modal v-if="modal==='feedback-history'" :title="lanEnabled?'我的反馈记录':'本机反馈记录'" @close="modal=''"><div v-if="!state.feedback.length" class="empty-small">还没有反馈记录。</div><article v-for="f in state.feedback" :key="f.id" class="feedback-entry"><span class="badge soft">{{f.type}} · {{f.id}}</span><p>{{f.text}}</p><small>{{lanEnabled?'已保存共享服务':'已保存本机 · 未发送'}}</small></article></Modal>
  <StockTextEntry v-if="modal==='stock-text'&&isChef" :key="kitchenId" :stock="kitchenStock" :save="saveStockBatch" @close="modal=''"/>
  <AccountSettings v-if="modal==='account'" :has-kitchen="!!kitchen" @close="modal=''" @manage="modal='kitchen-manage'"/>
  <ThemePicker v-if="modal==='theme'" :selected="currentTheme.id" @select="changeTheme" @close="modal=''"/>
  <ReviewCenter :state="state" :person="person" :now="now" :open="reviewOpen" :initial-meal-id="reviewMealId" :initial-recipe-id="reviewRecipeId" :busy="sharedBusy" :save="saveReview" @close="reviewOpen=false"/>
  <div v-if="toast" class="toast" role="status" aria-live="polite"><CheckCircle2 :size="18"/>{{toast}}</div>
</template>

<style scoped>
.dish-picture>.food-photo,.dish-picture>.food-missing{width:100%;height:100%;margin:0;filter:none}.dish-picture:hover>.food-photo{transform:scale(1.025)}.recipe-visual{padding-bottom:0;overflow:hidden}.recipe-attribution{display:flex;align-items:flex-start;gap:7px;margin:24px 0 0;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:11px;line-height:1.8}.recipe-attribution>svg{margin-top:3px}.recipe-attribution a{display:inline-flex;align-items:center;gap:3px;color:var(--orange);text-underline-offset:3px}.recipe-attribution a:hover{text-decoration:underline}.stock-entry-actions{display:flex;gap:10px;flex-wrap:wrap}.stock-entry-actions .btn{min-height:46px}
@media(max-width:600px){.stock-entry-actions{width:100%;display:grid;grid-template-columns:1fr 1fr}.stock-entry-actions .btn{justify-content:center}}
</style>
