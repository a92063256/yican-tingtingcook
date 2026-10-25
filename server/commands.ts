import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { acceptInvite, canOrder, dinerOwner, memberRole, people, isKitchenHost, shoppingList, visibleKitchens, type State } from '../src/domain'
import { canReviewMeal, reviewRecipes, reviewTextLimit } from '../src/reviews'
import { emptyMarks, favoriteKey, migrateRecipeMarks } from '../src/preferences'

const id=z.string().min(1).max(160)
const label=z.string().trim().min(1).max(80)
const expected=z.string().max(100000).nullable()
const ingredient=z.object({name:label,amount:z.number().finite().min(0).max(1e7).nullable(),unit:z.string().trim().min(1).max(16),type:z.enum(['food','seasoning'])})
const recipe=z.object({name:label,category:label,minutes:z.number().int().min(1).max(600).nullable(),servings:z.number().int().min(1).max(20).nullable(),note:z.string().max(200),ingredients:z.array(ingredient).min(1).max(100),steps:z.array(z.string().trim().min(1).max(3000)).max(100),source:z.string().max(2000).refine(s=>!s||/^https?:\/\//i.test(s))})
const art=z.string().regex(/^(?:placeholder|tomato|soup|shrimp|tofu|greens|beef|\/images\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp))$/i)
export const commandSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('review.save'),mealId:id,recipeId:id.nullable(),text:z.string().trim().min(1).max(reviewTextLimit),expected}),
  z.object({type:z.literal('order.submit'),mealId:id,recipeIds:z.array(id).min(1).max(200),note:z.string().max(150),expected}),
  z.object({type:z.literal('order.cancel'),mealId:id,expected}),
  z.object({type:z.literal('meal.portion'),mealId:id,recipeId:id,delta:z.union([z.literal(1),z.literal(-1)])}),
  z.object({type:z.literal('meal.status'),mealId:id,expected:z.enum(['open','prep','cooking'])}),
  z.object({type:z.literal('meal.reset'),mealId:id}),
  z.object({type:z.literal('shopping.check'),mealId:id,key:id,signature:z.string().max(20000),prepared:z.boolean()}),
  z.object({type:z.literal('stock.save'),kitchenId:id,id:id.optional(),value:ingredient,expected}),
  z.object({type:z.literal('stock.batch'),kitchenId:id,items:z.array(z.object({value:ingredient,expected})).min(1).max(100)}),
  z.object({type:z.literal('stock.useup'),id,expected}),
  z.object({type:z.literal('invite.create'),kitchenId:id,kind:z.enum(['long','temporary']),mealId:id.optional()}),
  z.object({type:z.literal('invite.join'),inviteId:id,role:z.enum(['chef','diner','guest'])}),
  z.object({type:z.literal('invite.revoke'),inviteId:id}),
  z.object({type:z.literal('member.remove'),kitchenId:id,userId:id}),
  z.object({type:z.literal('kitchen.leave'),kitchenId:id}),
  z.object({type:z.literal('kitchen.transfer'),kitchenId:id,userId:id,role:z.enum(['chef','diner'])}),
  z.object({type:z.literal('kitchen.dissolve'),kitchenId:id,name:label,expected}),
  z.object({type:z.literal('kitchen.naming'),kitchenId:id,name:label,chefLabel:label,dinerLabel:label,expected}),
  z.object({type:z.literal('kitchen.rename'),kitchenId:id,name:z.string().trim().min(1).max(18),expected}),
  z.object({type:z.literal('kitchen.create'),name:label,role:z.enum(['chef','diner'])}),
  z.object({type:z.literal('meal.create'),kitchenId:id,date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),name:label,startsAt:id,endsAt:id,deadline:id}),
  z.object({type:z.literal('recipe.save'),kitchenId:id,oldId:id.optional(),expected:expected.optional(),menuExpected:expected.optional(),value:recipe.extend({art:art.optional()})}),
  z.object({type:z.literal('recipe.remove'),kitchenId:id,recipeId:id}),
  z.object({type:z.literal('recipe.add'),kitchenId:id,recipeId:id}),
  z.object({type:z.literal('recipe.cover'),kitchenId:id,recipeId:id,cover:z.string().regex(/^\/images\/[a-z0-9][a-z0-9._-]*\.(?:png|jpe?g|webp)$/i)}),
  z.object({type:z.literal('recipe.mark'),kitchenId:id,recipeId:id,kind:z.enum(['signature','favorite']),marked:z.boolean()}),
  z.object({type:z.literal('feedback.save'),kind:z.enum(['建议','Bug']),text:z.string().trim().min(1).max(1000)})
])
export type Command=z.infer<typeof commandSchema>
export const envelopeSchema=z.object({requestId:z.string().uuid(),actor:id,command:commandSchema})
export class CommandError extends Error { constructor(message:string,public status=400){super(message)} }
export const fingerprint=(value:unknown)=>value==null?null:JSON.stringify(value)
function checkExpected(current:unknown,base:string|null){if(fingerprint(current)!==base)throw new CommandError('这项内容已被另一台设备修改，请重新打开后再保存。',409)}

export function applyCommand(s:State,actor:string,c:Command,now=Date.now()):Record<string,string> {
  if(!s.people?.[actor]&&!people[actor])throw new CommandError('未知身份',403)
  const kitchen=(kitchenId:string)=>{const k=s.kitchens.find(k=>k.id===kitchenId&&!k.archived);if(!k)throw new CommandError('厨房不存在或已解散',404);return k}
  const chef=(kitchenId:string)=>{const k=kitchen(kitchenId);if(k.chefId!==actor||memberRole(s,actor,kitchenId)!=='chef')throw new CommandError('只有本厨房的主厨可以执行此操作',403);return k}
  const manager=(kitchenId:string)=>{const k=kitchen(kitchenId);if(!isKitchenHost(s,actor,k))throw new CommandError('无权管理这个厨房',403);return k}
  const meal=(mealId:string)=>{const m=s.meals.find(m=>m.id===mealId);if(!m)throw new CommandError('餐次不存在',404);return m}
  const editableMeal=(mealId:string)=>{const m=meal(mealId);chef(m.kitchenId);if(['done','cancelled'].includes(m.status)||now>=+new Date(m.endsAt))throw new CommandError('本餐已结束，不能修改');return m}
  const orderable=(mealId:string)=>{const m=meal(mealId);if(!canOrder(s,actor,m,now))throw new CommandError('本餐已停止点菜或当前身份没有权限',403);return m}
  const revokeAccess=(kitchenId:string,userId:string)=>{
    s.members=s.members.filter(m=>m.kitchenId!==kitchenId||m.userId!==userId)
    const meals=new Set(s.meals.filter(m=>m.kitchenId===kitchenId).map(m=>m.id))
    for(const g of s.grants)if(g.userId===userId&&meals.has(g.mealId))g.revoked=true
  }
  switch(c.type){
    case 'review.save': {
      const m=meal(c.mealId)
      if(!canReviewMeal(s,actor,m,now))throw new CommandError('用餐结束后，参与本餐的成员才可以评价',403)
      const recipe=c.recipeId===null?null:reviewRecipes(s,m).find(r=>r.id===c.recipeId)
      if(c.recipeId!==null&&!recipe)throw new CommandError('只能评价本餐实际准备的菜品')
      const reviews=s.reviews??=[],old=reviews.find(r=>r.mealId===m.id&&r.userId===actor&&r.recipeId===c.recipeId)
      checkExpected(old,c.expected)
      const text=c.text.trim()
      if(!text||text.length>reviewTextLimit)throw new CommandError('请填写 1—500 字评价，可只用 emoji')
      const stamp=new Date(now).toISOString()
      if(old){old.text=text;old.updatedAt=stamp;return {id:old.id}}
      const id=randomUUID()
      reviews.push({id,kitchenId:m.kitchenId,mealId:m.id,userId:actor,recipeId:c.recipeId,recipeKey:recipe?(recipe.reviewKey??recipe.id):null,text,createdAt:stamp,updatedAt:stamp})
      return {id}
    }
    case 'order.submit': {
      const m=orderable(c.mealId),k=kitchen(m.kitchenId),old=s.orders.find(o=>o.mealId===m.id&&o.userId===actor)
      checkExpected(old,c.expected)
      const ids=[...new Set(c.recipeIds)]
      if(ids.some(id=>!s.recipes.some(r=>r.id===id)||(!k.recipeIds.includes(id)&&!old?.recipeIds.includes(id))))throw new CommandError('菜单已经更新，请重新选菜',409)
      if(old){old.recipeIds=ids;old.note=c.note}else s.orders.push({id:randomUUID(),userId:actor,mealId:m.id,recipeIds:ids,note:c.note,createdAt:new Date(now).toISOString()})
      break
    }
    case 'order.cancel': {orderable(c.mealId);const old=s.orders.find(o=>o.mealId===c.mealId&&o.userId===actor);checkExpected(old,c.expected);s.orders=s.orders.filter(o=>o!==old);break}
    case 'meal.portion': {const m=editableMeal(c.mealId);if(!s.orders.some(o=>o.mealId===m.id&&o.recipeIds.includes(c.recipeId)))throw new CommandError('本餐没有这道菜');m.portions[c.recipeId]=Math.max(0,Math.min(100,(m.portions[c.recipeId]??1)+c.delta));break}
    case 'meal.status': {const m=editableMeal(c.mealId);if(m.status!==c.expected)throw new CommandError('餐次状态已更新，请重试',409);if(!s.orders.some(o=>o.mealId===m.id))throw new CommandError('请先点菜');m.status=({open:'prep',prep:'cooking',cooking:'done'} as const)[c.expected];break}
    case 'meal.reset': {const m=meal(c.mealId);chef(m.kitchenId);if(now>=+new Date(m.endsAt))throw new CommandError('本餐已结束，不能重置');if(s.reviews?.some(r=>r.mealId===m.id))throw new CommandError('本餐已有餐后评价，请新建餐次');const cleared=s.orders.filter(o=>o.mealId===m.id).length;s.orders=s.orders.filter(o=>o.mealId!==m.id);m.status='open';m.portions={};for(const key of Object.keys(s.checked))if(key.startsWith(`${m.id}:`))delete s.checked[key];return {cleared:String(cleared)}}
    case 'shopping.check': {const m=editableMeal(c.mealId);const row=shoppingList(s,m).find(r=>r.key===c.key);if(!row||row.signature!==c.signature)throw new CommandError('食材需求已变化，请查看最新清单',409);s.checked[`${m.id}:${row.key}`]=`${c.prepared?'yes':'no'}:${row.signature}`;break}
    case 'stock.save': {chef(c.kitchenId);const old=c.id?s.stock.find(x=>x.id===c.id&&x.kitchenId===c.kitchenId):undefined;checkExpected(old,c.expected);if(c.id&&!old)throw new CommandError('库存不存在',404);if(s.stock.some(x=>x.kitchenId===c.kitchenId&&x.name===c.value.name&&x.unit===c.value.unit&&x.id!==c.id))throw new CommandError('已有同名同单位库存，请编辑现有记录',409);if(old)Object.assign(old,c.value);else s.stock.push({...c.value,id:randomUUID(),kitchenId:c.kitchenId});break}
    case 'stock.batch': {
      chef(c.kitchenId)
      const keys=new Set<string>()
      // Validate the entire batch before mutating; the Store commits it as one idempotent transaction.
      const additions=c.items.map(item=>{
        const {value}=item,key=JSON.stringify([value.name,value.unit])
        if(keys.has(key))throw new CommandError('同名同单位请合并成一项后保存')
        keys.add(key)
        const old=s.stock.find(x=>x.kitchenId===c.kitchenId&&x.name===value.name&&x.unit===value.unit)
        checkExpected(old,item.expected)
        if(value.amount===null||value.amount<.0001)throw new CommandError('批量入库数量至少为 0.0001')
        if(old?.amount===null)throw new CommandError(`「${value.name}」原数量待确认，请先编辑现有库存`)
        if(old&&old.type!==value.type)throw new CommandError(`「${value.name}」已有分类不同，请保持原分类或先修改库存`,409)
        const amount=Math.round(((old?.amount??0)+value.amount)*10000)/10000
        if(amount>1e7)throw new CommandError(`「${value.name}」合计数量过大，请核对`)
        return {old,value,amount}
      })
      for(const {old,value,amount} of additions){if(old)old.amount=amount;else s.stock.push({...value,amount,id:randomUUID(),kitchenId:c.kitchenId})}
      return {count:String(additions.length)}
    }
    case 'stock.useup': {const old=s.stock.find(x=>x.id===c.id);if(!old)throw new CommandError('库存不存在',404);chef(old.kitchenId);checkExpected(old,c.expected);if(old.amount===null)throw new CommandError('库存数量待确认，请先填写数量后再标记用完');old.amount=0;break}
    case 'invite.create': {manager(c.kitchenId);const m=c.kind==='temporary'?meal(c.mealId||''):undefined;if(m&&(m.kitchenId!==c.kitchenId||m.status!=='open'||now>=+new Date(m.deadline)||now>=+new Date(m.endsAt)))throw new CommandError('请选择仍可点菜的餐次');const inv={id:randomUUID(),kitchenId:c.kitchenId,type:c.kind,...(m?{mealId:m.id}:{}),expiresAt:m?.endsAt||new Date(now+7*86400000).toISOString()};s.invites.push(inv);return {id:inv.id}}
    case 'invite.join': {const error=acceptInvite(s,c.inviteId,actor,c.role,now);if(error)throw new CommandError(error,409);const inv=s.invites.find(i=>i.id===c.inviteId)!;return {kitchenId:inv.kitchenId,mealId:inv.mealId||''}}
    case 'invite.revoke': {const inv=s.invites.find(i=>i.id===c.inviteId);if(!inv)throw new CommandError('邀请不存在',404);manager(inv.kitchenId);inv.revoked=true;break}
    case 'member.remove': {
      const k=manager(c.kitchenId)
      if(c.userId===actor)throw new CommandError('请使用退出厨房')
      if(c.userId===k.chefId||c.userId===dinerOwner(s,k))throw new CommandError('不能移除厨房主人，请先由本人交接身份')
      if(!memberRole(s,c.userId,k.id)&&!s.grants.some(g=>g.userId===c.userId&&!g.revoked&&s.meals.some(m=>m.id===g.mealId&&m.kitchenId===k.id)))throw new CommandError('该成员已离开厨房',409)
      revokeAccess(k.id,c.userId);break
    }
    case 'kitchen.leave': {
      const k=kitchen(c.kitchenId)
      if(isKitchenHost(s,actor,k))throw new CommandError('主人请先交接身份，或解散厨房后离开')
      if(!memberRole(s,actor,k.id)&&!s.grants.some(g=>g.userId===actor&&!g.revoked&&s.meals.some(m=>m.id===g.mealId&&m.kitchenId===k.id)))throw new CommandError('你已不在这个厨房',409)
      revokeAccess(k.id,actor);break
    }
    case 'kitchen.transfer': {
      const k=manager(c.kitchenId),diner=dinerOwner(s,k)
      if((c.role==='chef'?k.chefId:diner)!==actor)throw new CommandError('只能交接自己的主人身份',403)
      if(c.userId===actor||c.userId===k.chefId||c.userId===diner||memberRole(s,c.userId,k.id)!=='diner')throw new CommandError('请选择本厨房的一位长期客人')
      k.dinerOwnerId=diner
      if(c.role==='chef'){k.chefId=c.userId;s.members.find(m=>m.kitchenId===k.id&&m.userId===actor)!.role='diner';s.members.find(m=>m.kitchenId===k.id&&m.userId===c.userId)!.role='chef'}
      else k.dinerOwnerId=c.userId
      if(k.ownerId===actor)k.ownerId=c.userId
      break
    }
    case 'kitchen.dissolve': {
      const k=manager(c.kitchenId);checkExpected(k,c.expected)
      if(c.name!==k.name)throw new CommandError('请输入完整的厨房名称确认')
      k.archived=true
      for(const inv of s.invites)if(inv.kitchenId===k.id)inv.revoked=true
      for(const g of s.grants)if(s.meals.some(m=>m.id===g.mealId&&m.kitchenId===k.id))g.revoked=true
      break
    }
    case 'kitchen.rename': {const k=kitchen(c.kitchenId);if(!isKitchenHost(s,actor,k))throw new CommandError('只有本厨房的主人可以修改厨房名称',403);checkExpected(k.name,c.expected);k.name=c.name.trim();break}
    case 'kitchen.naming': {const k=manager(c.kitchenId);checkExpected({name:k.name,chefLabel:k.chefLabel,dinerLabel:k.dinerLabel},c.expected);Object.assign(k,{name:c.name,chefLabel:c.chefLabel,dinerLabel:c.dinerLabel});break}
    case 'kitchen.create': {const id=randomUUID();s.kitchens.push({id,name:c.name,subtitle:'把喜欢的人，放在一张餐桌旁。',chefId:c.role==='chef'?actor:null,ownerId:actor,dinerOwnerId:c.role==='diner'?actor:null,chefLabel:'主厨',dinerLabel:'食客',recipeIds:s.recipes.filter(r=>!r.archived&&!r.id.startsWith('private-')).slice(0,3).map(r=>r.id)});s.members.push({userId:actor,kitchenId:id,role:c.role});return {id}}
    case 'meal.create': {chef(c.kitchenId);const start=+new Date(c.startsAt),end=+new Date(c.endsAt),deadline=+new Date(c.deadline);if(![start,end,deadline].every(Number.isFinite)||deadline<=now||deadline>start||end<=start||!c.startsAt.startsWith(c.date+'T')||!c.deadline.startsWith(c.date+'T'))throw new CommandError('餐次时间无效');if(s.meals.some(m=>m.kitchenId===c.kitchenId&&m.date===c.date&&m.name===c.name))throw new CommandError('当天已有同名餐次',409);const id=randomUUID();s.meals.push({id,kitchenId:c.kitchenId,date:c.date,name:c.name,startsAt:c.startsAt,endsAt:c.endsAt,deadline:c.deadline,status:'open',portions:{}});return {id}}
    case 'recipe.save': {
      const k=chef(c.kitchenId),old=c.oldId?s.recipes.find(r=>r.id===c.oldId&&!r.archived):undefined
      if(c.oldId&&(!old||(!k.recipeIds.includes(c.oldId)&&old.id.startsWith('private-'))))throw new CommandError('菜谱已更新，请重新打开编辑',409)
      if(c.expected!==undefined)checkExpected(old,c.expected)
      if(c.menuExpected!==undefined)checkExpected(k.recipeIds,c.menuExpected)
      if(old?.id.startsWith('private-')&&!k.recipeIds.includes(old.id))throw new CommandError('菜谱已更新，请重新打开编辑',409)
      const id='private-'+randomUUID()
      const selectedArt=c.value.art??old?.art??'tofu'
      s.recipes.push({...c.value,id,reviewKey:old?.reviewKey??old?.id??id,art:selectedArt,...(old?.sourceText?{sourceText:old.sourceText}:{}),...(old?.origin?{origin:old.origin}:{}),...(old?.coverInfo&&old.art===selectedArt?{coverInfo:old.coverInfo}:{})})
      if(old&&k.recipeIds.includes(old.id)){k.recipeIds=k.recipeIds.map(r=>r===old.id?id:r);migrateRecipeMarks(s.recipeMarks??=emptyMarks(),k.id,old.id,id)}else k.recipeIds.push(id)
      return {id}
    }
    case 'recipe.remove': {const k=chef(c.kitchenId);if(!k.recipeIds.includes(c.recipeId))throw new CommandError('这道菜已不在菜单中',409);k.recipeIds=k.recipeIds.filter(id=>id!==c.recipeId);break}
    case 'recipe.add': {const k=chef(c.kitchenId);if(!s.recipes.some(r=>r.id===c.recipeId&&!r.archived&&!r.id.startsWith('private-')))throw new CommandError('公共菜谱不存在');if(!k.recipeIds.includes(c.recipeId))k.recipeIds.push(c.recipeId);break}
    case 'recipe.cover': {const k=chef(c.kitchenId),recipe=s.recipes.find(r=>r.id===c.recipeId);if(!recipe||recipe.archived||!k.recipeIds.includes(recipe.id))throw new CommandError('菜谱不可用',404);return applyCommand(s,actor,{type:'recipe.save',kitchenId:k.id,oldId:recipe.id,value:{...recipe,source:recipe.source??'',art:c.cover}},now)}
    case 'recipe.mark': {const k=kitchen(c.kitchenId);if(!visibleKitchens(s,actor,now).some(x=>x.id===k.id))throw new CommandError('没有厨房成员权限',403);if(!s.recipes.some(r=>r.id===c.recipeId&&!r.archived&&(k.recipeIds.includes(r.id)||!r.id.startsWith('private-'))))throw new CommandError('菜谱不可用');if(c.kind==='signature'){chef(k.id);if(!k.recipeIds.includes(c.recipeId))throw new CommandError('请先加入菜单')};const marks=s.recipeMarks??=emptyMarks();const records=c.kind==='signature'?marks.signatures:marks.favorites,key=c.kind==='signature'?k.id:favoriteKey(k.id,actor);const ids=records[key]??[];records[key]=c.marked?[...new Set([...ids,c.recipeId])]:ids.filter(id=>id!==c.recipeId);break}
    case 'feedback.save': {const id='YC-'+randomUUID();s.feedback.push({id,type:c.kind,userId:actor,text:`${(s.people?.[actor]??people[actor]).name}：${c.text}`,createdAt:new Date(now).toISOString()});return {id}}
  }
  return {}
}
