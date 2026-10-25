import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Accounts, type Account } from './auth'
import { Store } from './store'
import { createAppServer } from './http'
import type { Command } from './commands'

const cleanups:(()=>void|Promise<void>)[]=[]
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()})
const registration=(name:string,passwordless=false)=>({username:name,nickname:'昵称'+name,password:'test-pass-123',passwordless,role:'diner'})
async function fixture(seedDemo=false){
  const directory=mkdtempSync(join(tmpdir(),'yican-accounts-')),path=join(directory,'kitchen.sqlite')
  const store=new Store(path,{seedDemo}),server=createAppServer(store,directory)
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  cleanups.push(async()=>{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()});try{store.close()}catch{};rmSync(directory,{recursive:true,force:true})})
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
  function client(){
    let cookie=''
    return {
      get cookie(){return cookie},
      async call(path:string,body?:unknown,headers:Record<string,string>={}){
        const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json','X-Yican-Request':'1'}),Cookie:cookie,...headers},body:body===undefined?undefined:JSON.stringify(body)})
        if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie')!.split(';')[0]
        return {status:response.status,body:await response.json(),headers:response.headers}
      },
      async command(command:Command){return this.call('/api/commands',{requestId:randomUUID(),command})}
    }
  }
  return {store,path,base,client}
}

it('starts with no demo kitchens, registers a real account and stores only derived credentials',async()=>{
  const {client,store}=await fixture(),a=client()
  expect((await a.call('/api/state')).status).toBe(401)
  expect((await a.command({type:'kitchen.create',name:'偷跑',role:'chef'})).status).toBe(401)
  expect((await a.call('/api/auth/me')).body.firstAccount).toBe(true)
  const result=await a.call('/api/auth/register',registration('alice'))
  expect(result.status).toBe(200)
  expect(result.headers.get('set-cookie')).toMatch(/HttpOnly; SameSite=Lax; Path=\//)
  expect(result.body.user).toMatchObject({username:'alice',nickname:'昵称alice',passwordless:false,preferredRole:'diner'})
  expect(JSON.stringify(result.body)).not.toContain('password_hash')
  const row=store.db.prepare('SELECT * FROM accounts').get()!
  expect(row.password_hash).not.toContain('test-pass-123')
  expect(String(row.password_hash).length).toBeGreaterThan(100)
  expect(store.db.prepare('SELECT token_hash FROM account_sessions').get()!.token_hash).not.toBe(a.cookie.split('=')[1])
  const snapshot=(await a.call('/api/state')).body
  expect(snapshot.state.kitchens).toEqual([])
  expect(snapshot.state.people[result.body.user.id].name).toBe('昵称alice')
  expect(JSON.stringify(snapshot)).not.toContain('password_hash')
  expect(JSON.stringify(snapshot)).not.toContain('token_hash')
  expect((await a.call('/api/auth/me')).body.firstAccount).toBe(false)
})

it('requires an explicit passwordless account and accepts unique nickname or case-insensitive username',async()=>{
  const {client}=await fixture(),a=client(),b=client()
  await a.call('/api/auth/register',registration('alice'))
  expect((await b.call('/api/auth/login',{identifier:'alice',passwordless:true})).status).toBe(401)
  expect((await b.call('/api/auth/login',{identifier:'alice',passwordless:false,password:'wrong'})).status).toBe(401)
  expect((await b.call('/api/auth/login',{identifier:'ALICE',passwordless:false,password:'test-pass-123'})).status).toBe(200)
  await a.call('/api/auth/register',registration('bobby',true))
  expect((await b.call('/api/auth/login',{identifier:'昵称bobby',passwordless:true})).status).toBe(200)
  expect((await b.call('/api/auth/login',{identifier:'bobby',passwordless:false,password:'test-pass-123'})).status).toBe(401)
})

it('rejects duplicate or ambiguous identifiers, invalid input and cross-origin auth writes',async()=>{
  const {client,store}=await fixture(),a=client()
  await a.call('/api/auth/register',registration('alice',true))
  for(const value of [{...registration('ALICE',true),nickname:'另一个昵称'},{...registration('bobby',true),nickname:'alice'},{...registration('bobby',true),nickname:'昵称alice'}])expect((await a.call('/api/auth/register',value)).status).toBe(409)
  expect((await a.call('/api/auth/register',{...registration('bobby'),password:'123'})).status).toBe(400)
  expect((await a.call('/api/auth/register',{...registration('不合法账号'),passwordless:true})).status).toBe(400)
  expect((await a.call('/api/auth/register',registration('bobby',true),{Origin:'http://another-site'})).status).toBe(403)
  expect((await a.call('/api/auth/logout',{}, {'X-Yican-Request':'0'})).status).toBe(403)
  expect((await a.call('/api/auth/me')).body.user.username).toBe('alice')
  expect(store.db.prepare('SELECT count(*) AS n FROM accounts').get()!.n).toBe(1)
})

it('enforces one host of each kind, serializes competing joins and keeps guests out of management',async()=>{
  const {client,store}=await fixture(),diner=client(),chef=client(),guest=client(),other=client()
  await diner.call('/api/auth/register',registration('diner',true))
  await chef.call('/api/auth/register',{...registration('chef1',true),role:'chef'})
  await guest.call('/api/auth/register',registration('guest1',true))
  await other.call('/api/auth/register',registration('chef2',true))
  const kitchenId=(await diner.command({type:'kitchen.create',name:'等主厨的厨房',role:'diner'})).body.result.id
  const inviteId=(await diner.command({type:'invite.create',kitchenId,kind:'long'})).body.result.id
  expect((await client().call('/api/invites/'+inviteId)).body).toMatchObject({chefAvailable:true,dinerAvailable:false})
  const joins=await Promise.all([chef.command({type:'invite.join',inviteId,role:'chef'}),other.command({type:'invite.join',inviteId,role:'chef'})])
  expect(joins.map(r=>r.status).sort()).toEqual([200,409])
  expect((await guest.command({type:'invite.join',inviteId,role:'diner'})).status).toBe(409)
  expect((await guest.command({type:'invite.join',inviteId,role:'guest'})).status).toBe(200)
  expect((await guest.command({type:'invite.create',kitchenId,kind:'long'})).status).toBe(403)
  expect((await guest.command({type:'kitchen.rename',kitchenId,name:'不允许',expected:JSON.stringify('等主厨的厨房')})).status).toBe(403)
  const k=store.snapshot().state.kitchens.find(k=>k.id===kitchenId)!
  expect((await guest.call('/api/commands',{requestId:randomUUID(),actor:k.chefId,command:{type:'invite.create',kitchenId,kind:'long'}})).status).toBe(403)
  expect((await guest.call('/api/commands',null)).status).toBe(400)
  expect((await diner.command({type:'kitchen.rename',kitchenId,name:'一起吃饭',expected:JSON.stringify(k.name)})).status).toBe(200)
})

it('never exposes unrelated kitchens, private recipes, stock or credentials through full or changed reads',async()=>{
  const {client,store}=await fixture(),a=client(),b=client()
  await a.call('/api/auth/register',registration('alice',true));await b.call('/api/auth/register',registration('bobby',true))
  const kitchenId=(await a.command({type:'kitchen.create',name:'私家厨房',role:'chef'})).body.result.id
  await a.command({type:'stock.save',kitchenId,value:{name:'私藏食材',amount:1,unit:'克',type:'food'},expected:null})
  await a.command({type:'recipe.save',kitchenId,value:{name:'独家菜谱',category:'私房菜',minutes:10,servings:1,note:'秘密做法',ingredients:[{name:'私藏食材',amount:1,unit:'克',type:'food'}],steps:['私房步骤'],source:''}})
  await a.command({type:'feedback.save',kind:'建议',text:'只属于我的反馈'})
  for(const path of ['/api/state','/api/state?since=1']){
    const response=await b.call(path),text=JSON.stringify(response.body)
    expect(response.body.state.kitchens).toEqual([])
    for(const secret of ['私家厨房','私藏食材','独家菜谱','只属于我的反馈','password_hash','token_hash'])expect(text).not.toContain(secret)
    expect(response.body.changes).toBeUndefined()
  }
  expect((await a.call('/api/state')).body.state.stock).toHaveLength(1)
  expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})

it('preserves an invitation through registration and denies an expired invitation without half-registering',async()=>{
  const {client,store}=await fixture(),owner=client(),newcomer=client()
  await owner.call('/api/auth/register',registration('owner',true))
  const kitchenId=(await owner.command({type:'kitchen.create',name:'邀请小厨',role:'chef'})).body.result.id
  const inviteId=(await owner.command({type:'invite.create',kitchenId,kind:'long'})).body.result.id
  expect((await newcomer.call('/api/auth/register',{...registration('newuser'),inviteId})).status).toBe(200)
  expect((await newcomer.command({type:'invite.join',inviteId,role:'diner'})).status).toBe(200)
  expect((await newcomer.call('/api/state')).body.state.kitchens[0].name).toBe('邀请小厨')
  store.update(s=>{s.invites.find(i=>i.id===inviteId)!.expiresAt=new Date(Date.now()-1000).toISOString()})
  expect((await client().call('/api/invites/'+inviteId)).status).toBe(404)
  expect((await client().call('/api/auth/register',{...registration('expired',true),inviteId})).status).toBe(404)
  expect(store.db.prepare('SELECT 1 FROM accounts WHERE username=?').get('expired')).toBeUndefined()
})

it('limits a temporary guest to one meal and removes ordering and menu access after expiry',async()=>{
  const {client,store}=await fixture(),owner=client(),guest=client()
  await owner.call('/api/auth/register',registration('owner',true));await guest.call('/api/auth/register',registration('guest',true))
  const kitchenId=(await owner.command({type:'kitchen.create',name:'单餐小厨',role:'chef'})).body.result.id
  const time=(hours:number)=>new Date(Date.now()+hours*3600000).toISOString(),start=time(2),date=start.slice(0,10)
  const mealId=(await owner.command({type:'meal.create',kitchenId,date,name:'晚餐',startsAt:start,deadline:start,endsAt:time(4)})).body.result.id
  const inviteId=(await owner.command({type:'invite.create',kitchenId,kind:'temporary',mealId})).body.result.id
  expect((await guest.command({type:'invite.join',inviteId,role:'chef'})).status).toBe(409)
  expect((await guest.command({type:'invite.join',inviteId,role:'guest'})).status).toBe(200)
  const snapshot=(await guest.call('/api/state')).body,recipeId=snapshot.state.kitchens[0].recipeIds[0]
  expect(snapshot.state.meals.map((m:{id:string})=>m.id)).toEqual([mealId])
  expect(snapshot.state.invites).toEqual([])
  expect((await guest.command({type:'order.submit',mealId,recipeIds:[recipeId],note:'一起吃饭',expected:null})).status).toBe(200)
  store.update(s=>{s.meals.find(m=>m.id===mealId)!.endsAt=new Date(Date.now()-1000).toISOString()})
  const expired=(await guest.call('/api/state')).body
  expect(expired.state.kitchens[0].recipeIds).toEqual([])
  expect(expired.state.orders[0].note).toBe('一起吃饭')
  expect((await guest.command({type:'order.cancel',mealId,expected:null})).status).toBe(403)
  expect((await client().call('/api/invites/'+inviteId)).status).toBe(410)
})

it('changes passwords atomically, rejects the old password and revokes other sessions',async()=>{
  const {client}=await fixture(),a=client(),b=client(),c=client()
  await a.call('/api/auth/register',registration('alice'))
  await b.call('/api/auth/login',{identifier:'alice',password:'test-pass-123',passwordless:false})
  expect((await a.call('/api/auth/security',{passwordless:false,currentPassword:'wrong',newPassword:'new-pass-456'})).status).toBe(400)
  expect((await b.call('/api/state')).status).toBe(200)
  const oldCookie=a.cookie
  expect((await a.call('/api/auth/security',{passwordless:false,currentPassword:'test-pass-123',newPassword:'new-pass-456'})).status).toBe(200)
  expect(a.cookie).not.toBe(oldCookie)
  expect((await a.call('/api/state')).status).toBe(200)
  expect((await b.call('/api/state')).status).toBe(401)
  expect((await c.call('/api/auth/login',{identifier:'alice',password:'test-pass-123',passwordless:false})).status).toBe(401)
  expect((await c.call('/api/auth/login',{identifier:'alice',password:'new-pass-456',passwordless:false})).status).toBe(200)
  expect((await c.call('/api/auth/logout',{})).status).toBe(200)
  expect((await c.call('/api/state')).status).toBe(401)
})

it('can enable and disable passwordless mode without bypassing the existing password',async()=>{
  const {client,store}=await fixture(),a=client(),b=client()
  await a.call('/api/auth/register',registration('alice'))
  expect((await a.call('/api/auth/security',{passwordless:true})).status).toBe(400)
  expect((await a.call('/api/auth/security',{passwordless:true,currentPassword:'test-pass-123'})).status).toBe(200)
  expect(store.db.prepare('SELECT password_hash FROM accounts').get()!.password_hash).toBeNull()
  expect((await b.call('/api/auth/login',{identifier:'alice',passwordless:true})).status).toBe(200)
  expect((await a.call('/api/auth/security',{passwordless:false,newPassword:'protected-again'})).status).toBe(200)
  expect((await b.call('/api/state')).status).toBe(401)
  expect((await b.call('/api/auth/login',{identifier:'alice',passwordless:true})).status).toBe(401)
  expect((await b.call('/api/auth/login',{identifier:'alice',passwordless:false,password:'protected-again'})).status).toBe(200)
})

it('rolls back the password and session revocation together if issuing a replacement session fails',async()=>{
  const {client,store}=await fixture(),a=client()
  const {body}=await a.call('/api/auth/register',registration('alice'))
  const accounts=new Accounts(store),before=store.db.prepare('SELECT password_hash FROM accounts').get()!.password_hash
  store.db.exec("CREATE TRIGGER reject_session BEFORE INSERT ON account_sessions BEGIN SELECT RAISE(ABORT,'test disk failure'); END")
  await expect(accounts.security(body.user as Account,{passwordless:false,currentPassword:'test-pass-123',newPassword:'new-pass-456'})).rejects.toThrow('test disk failure')
  expect(store.db.prepare('SELECT password_hash FROM accounts').get()!.password_hash).toBe(before)
  expect(accounts.current(a.cookie)?.username).toBe('alice')
})

it('persists accounts, sessions, memberships and profiles across a database restart',async()=>{
  const {client,store,path}=await fixture(),a=client()
  await a.call('/api/auth/register',registration('alice'))
  await a.command({type:'kitchen.create',name:'重启还在',role:'diner'})
  store.close()
  const reopened=new Store(path,{seedDemo:false}),accounts=new Accounts(reopened)
  try{
    expect(accounts.current(a.cookie)?.username).toBe('alice')
    expect((await accounts.login({identifier:'昵称alice',password:'test-pass-123',passwordless:false},'reopen')).user.nickname).toBe('昵称alice')
    expect(reopened.snapshot().state.kitchens[0].name).toBe('重启还在')
    expect(reopened.snapshot().state.people?.[accounts.current(a.cookie)!.id].name).toBe('昵称alice')
    expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
  }finally{reopened.close()}
})

it('explicitly adopts legacy hosts and preserves old orders and recipes through invited registration',async()=>{
  const {client,store}=await fixture(true),diner=client(),chef=client(),before=store.snapshot().state
  expect((await diner.call('/api/auth/me')).body.legacySlots).toEqual({chef:true,diner:true})
  expect((await diner.call('/api/auth/register',{...registration('diner',true),adoptLegacy:true})).body.user.id).toBe('lin')
  const inviteId=(await diner.command({type:'invite.create',kitchenId:'home',kind:'long'})).body.result.id
  expect((await chef.call('/api/auth/register',{...registration('chef1',true),role:'chef',inviteId})).body.user.id).toBe('chen')
  expect((await chef.command({type:'invite.join',inviteId,role:'chef'})).status).toBe(200)
  const after=store.snapshot().state
  expect(after.orders).toEqual(before.orders)
  expect(after.recipes).toEqual(before.recipes)
  expect(after.kitchens.find(k=>k.id==='home')?.dinerOwnerId).toBe('lin')
  expect((await chef.call('/api/state')).body.state.people.chen.name).toBe('昵称chef1')
  expect((await client().call('/api/auth/register',{...registration('thief',true),adoptLegacy:true})).status).toBe(409)
})
