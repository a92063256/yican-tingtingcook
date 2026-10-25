import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Store } from './store'
import { applyCommand, fingerprint, type Command } from './commands'
import { createAppServer } from './http'
import { fixtureSession } from './test-session'

const cleanups:(()=>Promise<void>|void)[]=[]
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup()})
function fixture(){const directory=mkdtempSync(join(tmpdir(),'yican-test-'));cleanups.push(()=>rmSync(directory,{recursive:true,force:true}));const path=join(directory,'db.sqlite'),store=new Store(path);cleanups.push(()=>{try{store.close()}catch{}});return {store,path,directory}}
const envelope=(actor:'lin'|'chen'|'guest',command:Command)=>({actor,command,requestId:randomUUID()})

describe('shared transactions',()=>{
 it('lets permanent diners and chefs rename only their kitchen and preserves it across restart',()=>{
  const {store,path}=fixture(),before=store.snapshot().state,k=before.kitchens.find(k=>k.id==='home')!
  store.execute(envelope('lin',{type:'kitchen.rename',kitchenId:k.id,name:'  我们的小厨房 🥰  ',expected:fingerprint(k.name)}))
  const renamed=store.snapshot().state.kitchens.find(row=>row.id===k.id)!
  expect(renamed).toEqual({...k,name:'我们的小厨房 🥰'})
  store.execute(envelope('chen',{type:'kitchen.rename',kitchenId:k.id,name:'一起好好吃饭',expected:fingerprint(renamed.name)}))
  store.close();const reopened=new Store(path);cleanups.push(()=>reopened.close())
  const after=reopened.snapshot().state
  expect(after).toEqual({...before,kitchens:before.kitchens.map(row=>row.id===k.id?{...row,name:'一起好好吃饭'}:row)})
 })
 it('rejects guests and outsiders from renaming, while letting the two hosts manage their kitchen',()=>{
  const {store}=fixture(),k=store.snapshot().state.kitchens.find(k=>k.id==='home')!
  const rename=()=>envelope('guest',{type:'kitchen.rename',kitchenId:k.id,name:'来客的厨房',expected:fingerprint(k.name)})
  expect(()=>store.execute(rename())).toThrow('主人')
  const invite=store.execute(envelope('chen',{type:'invite.create',kitchenId:k.id,kind:'temporary',mealId:'home-1-0'})).result.id
  store.execute(envelope('guest',{type:'invite.join',inviteId:invite,role:'diner'}))
  expect(()=>store.execute(rename())).toThrow('主人')
  expect(store.execute(envelope('lin',{type:'invite.create',kitchenId:k.id,kind:'long'})).result.id).toBeTruthy()
  const longInvite=store.execute(envelope('chen',{type:'invite.create',kitchenId:k.id,kind:'long'})).result.id
  store.execute(envelope('guest',{type:'invite.join',inviteId:longInvite,role:'guest'}))
  expect(()=>store.execute(rename())).toThrow('主人')
 })
 it('rejects empty or overlong kitchen names and stale concurrent rename attempts',()=>{
  const {store}=fixture(),k=store.snapshot().state.kitchens.find(k=>k.id==='home')!
  const rename=(name:string)=>envelope('lin',{type:'kitchen.rename',kitchenId:k.id,name,expected:fingerprint(k.name)})
  for(const name of ['   ','长'.repeat(19)])expect(()=>store.execute(rename(name))).toThrow()
  store.execute(rename('新名字'))
  const current=store.snapshot()
  expect(()=>store.execute(rename('过时的名字'))).toThrow('另一台设备')
  expect(store.snapshot()).toMatchObject({state:current.state,revision:current.revision})
 })
 it('saves an unfinished recipe and chef signature without inventing quantities',()=>{
  const {store}=fixture()
  const id=store.execute(envelope('chen',{type:'recipe.save',kitchenId:'home',value:{name:'待补做法的炒鸡',category:'风味好菜',minutes:null,servings:null,note:'大蒜几粒',ingredients:[{name:'公鸡',amount:3,unit:'斤',type:'food'},{name:'大蒜',amount:null,unit:'粒',type:'food'}],steps:[],source:''}})).result.id
  store.execute(envelope('chen',{type:'recipe.mark',kitchenId:'home',recipeId:id,kind:'signature',marked:true}))
  const state=store.snapshot().state,recipe=state.recipes.find(r=>r.id===id)!
  expect(recipe.steps).toEqual([])
  expect(recipe.minutes).toBeNull()
  expect(recipe.servings).toBeNull()
  expect(recipe.ingredients[1].amount).toBeNull()
  expect(state.kitchens.find(k=>k.id==='home')!.recipeIds).toContain(id)
  expect(state.recipeMarks?.signatures.home).toContain(id)
 })

 it('preserves independent orders, stock and marks from different clients',()=>{
  const {store}=fixture(),initial=store.snapshot().state,stock=initial.stock[0]
  store.execute(envelope('lin',{type:'order.submit',mealId:'home-1-0',recipeIds:['tomato'],note:'小禾',expected:null}))
  store.execute(envelope('chen',{type:'stock.save',kitchenId:'home',id:stock.id,value:{name:stock.name,amount:999,unit:stock.unit,type:stock.type},expected:fingerprint(stock)}))
  store.execute(envelope('chen',{type:'order.submit',mealId:'home-1-0',recipeIds:['tofu'],note:'小川',expected:null}))
  store.execute(envelope('lin',{type:'recipe.mark',kitchenId:'home',recipeId:'tomato',kind:'favorite',marked:true}))
  const latest=store.snapshot().state
  expect(latest.orders.filter(o=>o.mealId==='home-1-0')).toHaveLength(2)
  expect(latest.stock[0].amount).toBe(999)
  expect(latest.recipeMarks?.favorites['home:lin']).toEqual(['tomato'])
 })
 it('rejects stale edits and rolls back failures',()=>{
  const {store}=fixture(),stock=store.snapshot().state.stock[0]
  const change=(amount:number)=>envelope('chen',{type:'stock.save',kitchenId:'home',id:stock.id,value:{name:stock.name,amount,unit:stock.unit,type:stock.type},expected:fingerprint(stock)})
  store.execute(change(500));const revision=store.snapshot().revision
  expect(()=>store.execute(change(800))).toThrow('另一台设备')
  expect(store.snapshot().state.stock[0].amount).toBe(500)
  expect(store.snapshot().revision).toBe(revision)
 })
 it('deduplicates requests even after restart and preserves saved state',()=>{
  const {store,path}=fixture()
  const command=envelope('chen',{type:'meal.portion',mealId:'home-1-1',recipeId:'tomato',delta:1})
  store.execute(command);store.execute(command)
  store.close()
  const reopened=new Store(path);cleanups.push(()=>reopened.close())
  reopened.execute(command)
  expect(reopened.snapshot().state.meals.find(m=>m.id==='home-1-1')!.portions.tomato).toBe(2)
  expect(()=>reopened.execute({...command,actor:'lin'})).toThrow('请求编号')
 })
 it('checks role, menu membership and server-side deadline',()=>{
  const {store}=fixture(),s=store.snapshot().state,stock=s.stock[0]
  expect(()=>store.execute(envelope('lin',{type:'stock.useup',id:stock.id,expected:fingerprint(stock)}))).toThrow('主厨')
  expect(()=>store.execute(envelope('guest',{type:'order.submit',mealId:'home-1-0',recipeIds:['tomato'],note:'',expected:null}))).toThrow('权限')
  expect(()=>store.execute(envelope('lin',{type:'order.submit',mealId:'home-1-0',recipeIds:['not-a-recipe'],note:'',expected:null}))).toThrow('菜单')
  const m=s.meals.find(m=>m.id==='home-1-0')!
  expect(()=>applyCommand(s,'lin',{type:'order.submit',mealId:m.id,recipeIds:['tomato'],note:'',expected:null},+new Date(m.deadline))).toThrow('停止点菜')
 })
 it('does not let unknown stock be marked as used up',()=>{
  const {store}=fixture(),stock=store.snapshot().state.stock.find(item=>item.amount===null)!
  expect(()=>store.execute(envelope('chen',{type:'stock.useup',id:stock.id,expected:fingerprint(stock)}))).toThrow('数量待确认')
  expect(store.snapshot().state.stock.find(item=>item.id===stock.id)?.amount).toBeNull()
 })
 it('validates input without partial writes',()=>{
  const {store}=fixture(),before=store.snapshot().revision
  expect(()=>store.execute(envelope('chen',{type:'stock.save',kitchenId:'home',value:{name:'盐',unit:'克',type:'seasoning',amount:-1},expected:null}))).toThrow()
  expect(store.snapshot().revision).toBe(before)
 })
 it('resets an upcoming meal for another round of ordering',()=>{
  const {store}=fixture(),state=store.snapshot().state,meal=state.meals.find(m=>m.id==='home-1-0')!
  state.orders.push({id:'reset-order',userId:'lin',mealId:meal.id,recipeIds:['tomato'],note:'待清空',createdAt:new Date().toISOString()})
  meal.status='done';meal.portions.tomato=3;state.checked[`${meal.id}:番茄|克`]='yes:old'
  store.update(draft=>{Object.assign(draft,state)})
  const result=store.execute(envelope('chen',{type:'meal.reset',mealId:meal.id})).result
  const latest=store.snapshot().state
  expect(result.cleared).toBe('1');expect(latest.orders.some(o=>o.mealId===meal.id)).toBe(false)
  expect(latest.meals.find(m=>m.id===meal.id)).toMatchObject({status:'open',portions:{}})
  expect(Object.keys(latest.checked).some(k=>k.startsWith(`${meal.id}:`))).toBe(false)
 })
 it('lets a chef set a same-origin cover as a private version without rewriting historical photos',()=>{
  const {store}=fixture()
  const before=store.snapshot().state
  const {id}=store.execute(envelope('chen',{type:'recipe.cover',kitchenId:'home',recipeId:'tomato',cover:'/images/linyi-chicken.png'})).result
  const after=store.snapshot().state
  expect(after.recipes.find(r=>r.id===id)?.art).toBe('/images/linyi-chicken.png')
  expect(after.recipes.find(r=>r.id==='tomato')).toEqual(before.recipes.find(r=>r.id==='tomato'))
  expect(after.kitchens.find(k=>k.id==='home')?.recipeIds).toContain(id)
  expect(after.orders).toEqual(before.orders)
  expect(()=>store.execute(envelope('lin',{type:'recipe.cover',kitchenId:'home',recipeId:'tomato',cover:'/images/linyi-chicken.png'}))).toThrow('主厨')
 })
 it('joins invitations across clients and keeps a single chef',()=>{
  const {store}=fixture()
  const id=store.execute(envelope('lin',{type:'kitchen.create',name:'测试厨房',role:'diner'})).result.id
  const inv=store.execute(envelope('lin',{type:'invite.create',kitchenId:id,kind:'long'})).result.id
  store.execute(envelope('chen',{type:'invite.join',inviteId:inv,role:'chef'}))
  expect(()=>store.execute(envelope('guest',{type:'invite.join',inviteId:inv,role:'chef'}))).toThrow('已经有主厨')
  expect(store.snapshot().state.kitchens.find(k=>k.id===id)?.chefId).toBe('chen')
 })
 it('keeps recipe versions, favorites and feedback in shared storage',()=>{
  const {store}=fixture(),s=store.snapshot().state,r=s.recipes[0]
  store.execute(envelope('lin',{type:'recipe.mark',kitchenId:'home',recipeId:r.id,kind:'favorite',marked:true}))
  const result=store.execute(envelope('chen',{type:'recipe.save',kitchenId:'home',oldId:r.id,value:{...r,name:'新味道',source:''}})).result
  const latest=store.snapshot().state
  expect(latest.recipeMarks?.favorites['home:lin']).toContain(result.id)
  expect(latest.orders[0].recipeIds).toContain(r.id)
  store.execute(envelope('lin',{type:'feedback.save',kind:'建议',text:'实际使用反馈'}))
  expect(store.snapshot().state.feedback[0].text).toContain('小禾')
 })
})

it('serves two HTTP clients, blocks cross-origin writes, handles retry and persistence',async()=>{
 const {store,directory}=fixture();writeFileSync(join(directory,'index.html'),'<html><head></head><body>测试</body></html>')
 const server=createAppServer(store,directory)
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));cleanups.push(()=>new Promise<void>(resolve=>server.close(()=>resolve())))
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
 const cookies={lin:await fixtureSession(store,base,'lin'),chen:await fixtureSession(store,base,'chen')}
 expect(await (await fetch(base)).text()).toContain('__YICAN_LAN__=true')
 const post=(body:unknown,origin=base)=>fetch(base+'/api/commands',{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1',Cookie:cookies[(body as {actor?:'lin'|'chen'}).actor??'lin']??cookies.lin,Origin:origin},body:JSON.stringify(body)})
 const first=envelope('lin',{type:'order.submit',mealId:'home-1-0',recipeIds:['tomato'],note:'client A',expected:null})
 const second=envelope('chen',{type:'order.submit',mealId:'home-1-0',recipeIds:['tofu'],note:'client B',expected:null})
 const responses=await Promise.all([post(first),post(second)])
 expect(responses.map(r=>r.status)).toEqual([200,200])
 expect((await post(first)).status).toBe(200)
 const snapshot=await (await fetch(base+'/api/state',{headers:{Cookie:cookies.lin}})).json()
 expect(snapshot.state.orders.filter((o:{mealId:string})=>o.mealId==='home-1-0')).toHaveLength(2)
 expect((await post(envelope('lin',{type:'feedback.save',kind:'建议',text:'cross-site'}),'http://another-host')).status).toBe(403)
 expect((await post({actor:'unknown'})).status).toBe(403)
 expect((await post({})).status).toBe(400)
 expect((await fetch(base+'/api/reset',{method:'POST'})).status).toBe(404)
})
