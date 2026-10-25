import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { Store } from './store'
import { Accounts, stateForUser } from './auth'
import { fingerprint, type Command } from './commands'
import { canOrder, dinerOwner, visibleKitchens } from '../src/domain'
import { canReviewMeal } from '../src/reviews'

const cleanups:(()=>void)[]=[]
afterEach(()=>{for(const fn of cleanups.splice(0).reverse())fn()})
function fixture(){
  const store=new Store(':memory:');cleanups.push(()=>store.close())
  const run=(actor:string,command:Command)=>store.execute({requestId:randomUUID(),actor,command})
  const join=()=>{const {id}=run('chen',{type:'invite.create',kitchenId:'home',kind:'long'}).result;run('guest',{type:'invite.join',inviteId:id,role:'guest'});return id}
  return {store,run,join}
}
it('allows guests to leave, ends all kitchen access and preserves orders and reviews',()=>{
  const {store,run,join}=fixture();join()
  store.update(s=>{s.orders.push({id:'guest-order',userId:'guest',mealId:'home-1-1',recipeIds:['tomato'],note:'留在历史里',createdAt:new Date().toISOString()});s.grants.push({userId:'guest',mealId:'home-1-1'})})
  const before=store.snapshot().state
  run('guest',{type:'kitchen.leave',kitchenId:'home'})
  const s=store.snapshot().state,view=stateForUser(s,'guest')
  expect(s.orders).toEqual(before.orders)
  expect(s.reviews).toEqual(before.reviews)
  expect(s.members.some(m=>m.kitchenId==='home'&&m.userId==='guest')).toBe(false)
  expect(s.grants.find(g=>g.userId==='guest')?.revoked).toBe(true)
  expect(view.kitchens.some(k=>k.id==='home')).toBe(false)
  expect(view.orders.some(o=>o.id==='guest-order')).toBe(false)
})
it('does not allow owners to leave or be removed and rejects guest management',()=>{
  const {store,run,join}=fixture();const inv=join()
  const before=store.snapshot()
  for(const actor of ['chen','lin'])expect(()=>run(actor,{type:'kitchen.leave',kitchenId:'home'})).toThrow('先交接')
  expect(()=>run('chen',{type:'member.remove',kitchenId:'home',userId:'lin'})).toThrow('不能移除')
  expect(()=>run('guest',{type:'member.remove',kitchenId:'home',userId:'lin'})).toThrow('无权')
  expect(()=>run('guest',{type:'invite.revoke',inviteId:inv})).toThrow('无权')
  expect(()=>run('guest',{type:'kitchen.dissolve',kitchenId:'home',name:'冒用',expected:null})).toThrow('无权')
  expect(store.snapshot().revision).toBe(before.revision)
})
it('transfers chef authority atomically and allows the former owner to leave',()=>{
  const {store,run,join}=fixture();join()
  run('chen',{type:'kitchen.transfer',kitchenId:'home',userId:'guest',role:'chef'})
  const s=store.snapshot().state,k=s.kitchens.find(k=>k.id==='home')!
  expect(k.chefId).toBe('guest')
  expect(s.members.find(m=>m.kitchenId==='home'&&m.userId==='chen')?.role).toBe('diner')
  expect(s.members.find(m=>m.kitchenId==='home'&&m.userId==='guest')?.role).toBe('chef')
  expect(()=>run('chen',{type:'stock.save',kitchenId:'home',expected:null,value:{name:'盐',amount:1,unit:'份',type:'seasoning'}})).toThrow('只有')
  run('chen',{type:'kitchen.leave',kitchenId:'home'})
  expect(visibleKitchens(store.snapshot().state,'chen',Date.now()).some(k=>k.id==='home')).toBe(false)
})
it('transfers only the actor’s role to a permanent guest, not another owner or outsider',()=>{
  const {store,run,join}=fixture();join()
  expect(()=>run('lin',{type:'kitchen.transfer',kitchenId:'home',userId:'guest',role:'chef'})).toThrow('自己的')
  expect(()=>run('chen',{type:'kitchen.transfer',kitchenId:'home',userId:'lin',role:'chef'})).toThrow('长期客人')
  run('lin',{type:'kitchen.transfer',kitchenId:'home',userId:'guest',role:'diner'})
  expect(dinerOwner(store.snapshot().state,store.snapshot().state.kitchens.find(k=>k.id==='home')!)).toBe('guest')
  expect(()=>run('chen',{type:'kitchen.transfer',kitchenId:'home',userId:'guest',role:'chef'})).toThrow('长期客人')
})
it('revokes a link without removing existing members, and blocks public preview and reuse',()=>{
  const {store,run,join}=fixture();const inv=join()
  run('lin',{type:'invite.revoke',inviteId:inv})
  expect(()=>new Accounts(store).invite(inv)).toThrow('撤销')
  expect(()=>run('lin',{type:'invite.join',inviteId:inv,role:'guest'})).toThrow('撤销')
  expect(stateForUser(store.snapshot().state,'guest').kitchens.some(k=>k.id==='home')).toBe(true)
})
it('removes temporary access, preserves order and reuses the revoked grant on reinvite',()=>{
  const {store,run}=fixture()
  const inv=run('chen',{type:'invite.create',kitchenId:'home',kind:'temporary',mealId:'home-1-0'}).result.id
  run('guest',{type:'invite.join',inviteId:inv,role:'guest'})
  expect(stateForUser(store.snapshot().state,'chen').grants.some(g=>g.userId==='guest')).toBe(true)
  run('lin',{type:'member.remove',kitchenId:'home',userId:'guest'})
  let s=store.snapshot().state
  expect(stateForUser(s,'guest').kitchens.some(k=>k.id==='home')).toBe(false)
  expect(canOrder(s,'guest',s.meals.find(m=>m.id==='home-1-0')!,Date.now())).toBe(false)
  run('guest',{type:'invite.join',inviteId:inv,role:'guest'})
  s=store.snapshot().state
  expect(s.grants.filter(g=>g.userId==='guest'&&g.mealId==='home-1-0')).toHaveLength(1)
  expect(s.grants.find(g=>g.userId==='guest'&&g.mealId==='home-1-0')?.revoked).toBe(false)
})
it('archives kitchens and blocks projection, invitations, reviews and writes while retaining history',()=>{
  const {store,run,join}=fixture();const inv=join(),before=store.snapshot().state,k=before.kitchens.find(k=>k.id==='home')!
  expect(()=>run('chen',{type:'kitchen.dissolve',kitchenId:k.id,name:'错误名称',expected:fingerprint(k)})).toThrow('完整')
  expect(()=>run('chen',{type:'kitchen.dissolve',kitchenId:k.id,name:k.name,expected:null})).toThrow('修改')
  run('lin',{type:'kitchen.dissolve',kitchenId:k.id,name:k.name,expected:fingerprint(k)})
  const s=store.snapshot().state
  expect(s.orders).toEqual(before.orders);expect(s.meals).toEqual(before.meals)
  for(const user of ['chen','lin','guest']){
    const view=stateForUser(s,user)
    expect(view.kitchens.some(k=>k.id==='home')).toBe(false)
    expect(view.meals.some(m=>m.kitchenId==='home')).toBe(false)
    expect(canReviewMeal(s,user,s.meals.find(m=>m.kitchenId==='home')!,Date.now()+86400000)).toBe(false)
  }
  expect(()=>new Accounts(store).invite(inv)).toThrow()
  expect(()=>run('chen',{type:'invite.create',kitchenId:'home',kind:'long'})).toThrow('解散')
})
it('saves every recipe property locally, preserving source and historical versions',()=>{
  const {store,run}=fixture()
  store.update(s=>{s.recipes.find(r=>r.id==='tomato')!.sourceText='导入原文';s.kitchens.push({...s.kitchens[0],id:'other',recipeIds:['tomato']})})
  const before=store.snapshot().state,r=before.recipes.find(r=>r.id==='tomato')!,k=before.kitchens.find(k=>k.id==='home')!
  const value={...r,name:'新菜名',category:'我的分类',minutes:33,servings:4,note:'新介绍',art:'greens',source:'https://example.com/recipe',ingredients:[{name:'芹菜',amount:null,unit:'份',type:'food' as const}],steps:['洗净','炒熟']}
  const cmd:Command={type:'recipe.save',kitchenId:'home',oldId:r.id,expected:fingerprint(r),menuExpected:fingerprint(k.recipeIds),value}
  const id=run('chen',cmd).result.id,s=store.snapshot().state
  expect(s.recipes.find(r=>r.id===id)).toMatchObject({...value,id,sourceText:'导入原文'})
  expect(s.recipes.find(r=>r.id==='tomato')).toEqual(r)
  expect(s.orders).toEqual(before.orders)
  expect(s.kitchens.find(k=>k.id==='other')?.recipeIds).toContain('tomato')
  expect(()=>run('chen',cmd)).toThrow('修改')
  expect(()=>run('lin',{...cmd,oldId:id})).toThrow('只有')
})
it('lets chefs adapt public discovery recipes and remove dishes without deleting history',()=>{
  const {store,run}=fixture();store.update(s=>{s.kitchens.find(k=>k.id==='home')!.recipeIds=['tomato']});const s=store.snapshot().state,r=s.recipes.find(r=>r.id==='beef')!
  const {id}=run('chen',{type:'recipe.save',kitchenId:'home',oldId:r.id,value:{...r,source:''}}).result
  run('chen',{type:'recipe.remove',kitchenId:'home',recipeId:id})
  expect(store.snapshot().state.recipes.some(r=>r.id===id)).toBe(true)
  expect(store.snapshot().state.kitchens.find(k=>k.id==='home')?.recipeIds).not.toContain(id)
})
it('persists lifecycle flags and ownership through a database reopen',()=>{
  const folder=mkdtempSync(join(tmpdir(),'yican-management-'));cleanups.push(()=>rmSync(folder,{recursive:true,force:true}))
  const path=join(folder,'db.sqlite'),store=new Store(path)
  const run=(actor:string,command:Command)=>store.execute({requestId:randomUUID(),actor,command})
  const inv=run('chen',{type:'invite.create',kitchenId:'home',kind:'long'}).result.id
  run('guest',{type:'invite.join',inviteId:inv,role:'guest'})
  run('chen',{type:'kitchen.transfer',kitchenId:'home',userId:'guest',role:'chef'})
  const k=store.snapshot().state.kitchens.find(k=>k.id==='home')!
  run('guest',{type:'kitchen.dissolve',kitchenId:'home',name:k.name,expected:fingerprint(k)})
  const before=store.snapshot().state;store.close()
  const reopened=new Store(path);cleanups.push(()=>reopened.close())
  expect(reopened.snapshot().state).toEqual(before)
  expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
