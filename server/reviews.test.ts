import { afterEach, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AddressInfo } from 'node:net'
import { createSeed } from '../src/seed'
import { canOrder } from '../src/domain'
import { canReadMealReviews, canReviewMeal, recipeReviews } from '../src/reviews'
import { applyCommand, commandSchema, fingerprint, type Command } from './commands'
import { Store } from './store'
import { createAppServer } from './http'
import { fixtureSession } from './test-session'

function fixture(){const state=createSeed(),meal=state.meals.find(m=>m.id==='home-1-1')!;meal.status='done';return {state,meal}}
const command=(recipeId:string|null=null,text='谢谢主厨，今天也吃得好开心 🥰'):Extract<Command,{type:'review.save'}>=>({type:'review.save',mealId:'home-1-1',recipeId,text,expected:null})
it('stores whole-meal and dish reviews separately, including emoji-only content',()=>{
  const {state}=fixture()
  applyCommand(state,'lin',command());applyCommand(state,'lin',command('tomato','🫶🍚'))
  expect(state.reviews).toHaveLength(2)
  expect(state.reviews?.[0]).toMatchObject({kitchenId:'home',userId:'lin',recipeId:null,recipeKey:null})
  expect(state.reviews?.[1]).toMatchObject({recipeId:'tomato',recipeKey:'tomato',text:'🫶🍚'})
  expect(recipeReviews(state,'home',state.recipes[0],'chen')).toHaveLength(1)
  expect(recipeReviews(state,'friends',state.recipes[0],'lin')).toHaveLength(0)
})
it('rejects premature, cancelled, empty and unrelated meal/dish reviews',()=>{
  const {state,meal}=fixture();meal.status='open'
  expect(()=>applyCommand(state,'lin',command(),+new Date(meal.startsAt)-1000)).toThrow('用餐结束')
  expect(canReviewMeal(state,'lin',meal,+new Date(meal.endsAt))).toBe(true)
  meal.status='cancelled';expect(()=>applyCommand(state,'lin',command(),+new Date(meal.endsAt))).toThrow('用餐结束')
  meal.status='done';expect(()=>applyCommand(state,'guest',command())).toThrow('成员')
  expect(()=>applyCommand(state,'lin',command('beef'))).toThrow('实际准备')
  meal.portions.tomato=0;expect(()=>applyCommand(state,'lin',command('tomato'))).toThrow('实际准备')
  state.orders=[];expect(()=>applyCommand(state,'lin',command())).toThrow('用餐结束')
})
it('expired temporary diners can review their meal without regaining ordering rights',()=>{
  const {state,meal}=fixture(),now=+new Date(meal.endsAt)+1000
  state.orders.push({id:'guest-order',userId:'guest',mealId:meal.id,recipeIds:['tomato'],note:'',createdAt:new Date(now).toISOString()})
  expect(canReadMealReviews(state,'guest',meal)).toBe(false)
  state.grants.push({userId:'guest',mealId:meal.id})
  expect(canReviewMeal(state,'guest',meal,now)).toBe(true)
  expect(canOrder(state,'guest',meal,now)).toBe(false)
  applyCommand(state,'guest',command('tomato'),now)
  state.grants[0].revoked=true
  expect(canReadMealReviews(state,'guest',meal)).toBe(false)
  expect(()=>applyCommand(state,'guest',command(),now)).toThrow('成员')
})
it('edits only the author’s record, rejects stale writes, preserves created time',()=>{
  const {state}=fixture();applyCommand(state,'lin',command(),1000)
  const old=structuredClone(state.reviews![0])
  applyCommand(state,'lin',{...command(),text:'再补一句：下次还想吃 😋',expected:fingerprint(old)},2000)
  expect(state.reviews![0]).toMatchObject({id:old.id,createdAt:old.createdAt,updatedAt:new Date(2000).toISOString()})
  expect(()=>applyCommand(state,'lin',{...command(),expected:fingerprint(old)})).toThrow('另一台设备')
  applyCommand(state,'chen',command())
  expect(state.reviews?.map(r=>r.userId)).toEqual(['lin','chen'])
})
it('keeps dish review history across recipe versions and protects reviewed meals from reset',()=>{
  const {state,meal}=fixture();applyCommand(state,'lin',command('tomato'))
  const old=state.recipes.find(r=>r.id==='tomato')!
  const saved=applyCommand(state,'chen',{type:'recipe.save',kitchenId:'home',oldId:old.id,value:{...old,source:'',name:'我家的番茄炒蛋'}})
  const updated=state.recipes.find(r=>r.id===saved.id)!
  expect(updated.reviewKey).toBe('tomato')
  expect(recipeReviews(state,'home',updated,'chen')).toHaveLength(1)
  expect(state.reviews![0].recipeId).toBe('tomato')
  expect(()=>applyCommand(state,'chen',{type:'meal.reset',mealId:meal.id},+new Date(meal.endsAt)-1)).toThrow('已有餐后评价')
})
it('validates empty, whitespace, oversized messages and permits plain text with emoji',()=>{
  for(const text of ['','   ','x'.repeat(501)])expect(commandSchema.safeParse(command(null,text)).success).toBe(false)
  expect(commandSchema.safeParse(command(null,'  ❤️  ')).success).toBe(true)
})

const cleanup:(()=>Promise<void>|void)[]=[]
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn()})
it('persists reviews across restart, deduplicates retries, and serves another client through HTTP',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-reviews-'));cleanup.push(()=>rmSync(dir,{recursive:true,force:true}))
  const path=join(dir,'kitchen.sqlite'),store=new Store(path);cleanup.push(()=>{try{store.close()}catch{}})
  const {state}=fixture();store.update(draft=>{Object.assign(draft,state)})
  const envelope={requestId:randomUUID(),actor:'lin',command:command('tomato','火候刚好 ❤️')}
  const server=createAppServer(store,dir);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections()}))
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const cookie=await fixtureSession(store,base,'lin')
  const send=()=>fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1',Cookie:cookie},body:JSON.stringify(envelope)})
  expect((await send()).status).toBe(200);expect((await send()).status).toBe(200)
  const other=await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json()
  expect(other.state.reviews).toHaveLength(1);expect(other.state.reviews[0].text).toBe('火候刚好 ❤️')
  await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections()});store.close()
  const reopened=new Store(path);cleanup.push(()=>reopened.close())
  reopened.execute(envelope);expect(reopened.snapshot().state.reviews).toHaveLength(1)
})
