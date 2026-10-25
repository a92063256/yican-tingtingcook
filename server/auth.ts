import { createHash, randomBytes, randomUUID, scrypt as deriveKey, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { z } from 'zod'
import { dinerOwner, isKitchenHost, memberRole, people, type JoinRole, type State } from '../src/domain'
import { CommandError } from './commands'
import type { Store } from './store'

const scrypt=promisify(deriveKey)
const username=z.string().trim().regex(/^[a-zA-Z0-9_\-.]{3,32}$/,'账号需为 3—32 位字母、数字、点、横线或下划线').transform(s=>s.toLowerCase())
const nickname=z.string().trim().min(1).max(18)
const password=z.string().min(6,'密码至少 6 位').max(128)
const registerSchema=z.object({username,nickname,password:z.string().max(128).optional(),passwordless:z.boolean(),role:z.enum(['chef','diner']),adoptLegacy:z.boolean().default(false),inviteId:z.string().max(160).optional()})
const loginSchema=z.object({identifier:z.string().trim().min(1).max(64),password:z.string().max(128).optional(),passwordless:z.boolean()})
const securitySchema=z.object({currentPassword:z.string().max(128).optional(),newPassword:z.string().max(128).optional(),passwordless:z.boolean()})
interface AccountRow {user_id:string;username:string;nickname:string;password_hash:string|null;passwordless:number;preferred_role:'chef'|'diner'}
export interface Account {id:string;username:string;nickname:string;passwordless:boolean;preferredRole:'chef'|'diner'}
const account=(row:AccountRow):Account=>({id:row.user_id,username:row.username,nickname:row.nickname,passwordless:!!row.passwordless,preferredRole:row.preferred_role})
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
const duration=30*86400_000
async function hashPassword(value:string) {const salt=randomBytes(16).toString('hex');return salt+':'+(await scrypt(value,salt,64) as Buffer).toString('hex')}
async function verifyPassword(value:string,hash:string|null) {
  const [salt,key]=(hash??'00000000000000000000000000000000:'+ '00'.repeat(64)).split(':')
  const actual=await scrypt(value,salt,64) as Buffer,expected=Buffer.from(key,'hex')
  return !!hash&&actual.length===expected.length&&timingSafeEqual(actual,expected)
}

/** Credentials and sessions never enter the shared business state or sync log. */
export class Accounts {
  private attempts=new Map<string,{count:number;until:number}>()
  constructor(readonly store:Store){
    store.db.exec(`CREATE TABLE IF NOT EXISTS accounts(
      user_id TEXT PRIMARY KEY REFERENCES users(id),username TEXT NOT NULL UNIQUE COLLATE NOCASE,
      nickname TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT,passwordless INTEGER NOT NULL CHECK(passwordless IN(0,1)),
      preferred_role TEXT NOT NULL CHECK(preferred_role IN('chef','diner')),created_at INTEGER NOT NULL,
      CHECK((passwordless=1 AND password_hash IS NULL) OR (passwordless=0 AND password_hash IS NOT NULL)));
      CREATE TABLE IF NOT EXISTS account_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES accounts(user_id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS sessions_user ON account_sessions(user_id);
      CREATE INDEX IF NOT EXISTS sessions_expiry ON account_sessions(expires_at);`)
  }
  private row(id:string){return this.store.db.prepare('SELECT * FROM accounts WHERE user_id=?').get(id) as unknown as AccountRow|undefined}
  private legacySlots(){
    const s=this.store.snapshot().state
    const unclaimed=(id:string)=>!this.row(id)&&s.members.some(m=>m.userId===id)
    return {chef:unclaimed('chen'),diner:unclaimed('lin')}
  }
  setup(){return {firstAccount:!this.store.db.prepare('SELECT 1 FROM accounts LIMIT 1').get(),legacySlots:this.store.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()?{chef:false,diner:false}:this.legacySlots()}}
  current(cookie:string|undefined):Account|null {
    const token=(cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('yican_session='))?.slice(14)
    if(!token||!/^[a-f0-9]{64}$/.test(token))return null
    const row=this.store.db.prepare('SELECT a.* FROM accounts a JOIN account_sessions s ON a.user_id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(digest(token),Date.now()) as unknown as AccountRow|undefined
    return row?account(row):null
  }
  private session(userId:string){
    const token=randomBytes(32).toString('hex'),now=Date.now()
    this.store.db.prepare('DELETE FROM account_sessions WHERE expires_at<=?').run(now)
    this.store.db.prepare('INSERT INTO account_sessions VALUES(?,?,?)').run(digest(token),userId,now+duration)
    return {user:account(this.row(userId)!),token}
  }
  cookie(token:string,secure=false){return `yican_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${token?duration/1000:0}${secure?'; Secure':''}`}
  logout(cookie:string|undefined){const token=(cookie??'').split(';').map(s=>s.trim()).find(s=>s.startsWith('yican_session='))?.slice(14);if(token)this.store.db.prepare('DELETE FROM account_sessions WHERE token_hash=?').run(digest(token))}
  private checkNames(user:string,name:string){
    if(this.store.db.prepare('SELECT 1 FROM accounts WHERE username=? COLLATE NOCASE OR nickname=? COLLATE NOCASE OR username=? COLLATE NOCASE OR nickname=? COLLATE NOCASE').get(user,user,name,name))throw new CommandError('账号或昵称已被使用，请换一个',409)
  }
  private limited(key:string){
    const now=Date.now()
    for(const [id,value] of this.attempts)if(value.until<=now)this.attempts.delete(id)
    const entry=this.attempts.get(key)
    if(entry&&entry.until>now&&entry.count>=12)throw new CommandError('尝试过于频繁，请 15 分钟后再试',429)
    if(this.attempts.size>2048)this.attempts.delete(this.attempts.keys().next().value!)
    this.attempts.set(key,{count:(entry?.count??0)+1,until:entry?.until??now+15*60_000})
  }
  async register(raw:unknown,client:string){
    this.limited('register:'+client)
    const data=registerSchema.parse(raw)
    const hash=data.passwordless?null:await hashPassword(password.parse(data.password))
    let id='user-'+randomUUID(),result!:ReturnType<Accounts['session']>
    this.store.update(state=>{
      this.checkNames(data.username,data.nickname)
      if(data.inviteId)this.invite(data.inviteId)
      const first=!this.store.db.prepare('SELECT 1 FROM accounts LIMIT 1').get()
      if(data.adoptLegacy){
        if(!first)throw new CommandError('首次接续已完成，请使用厨房邀请加入',409)
        const candidate=data.role==='chef'?'chen':'lin'
        if(!state.members.some(m=>m.userId===candidate)||this.row(candidate))throw new CommandError('该历史身份不可接续',409)
        id=candidate
      } else if(data.inviteId){
        // A valid invite may bind the other unclaimed legacy host, preserving historical records.
        const preview=this.invite(data.inviteId)
        const k=state.kitchens.find(k=>k.id===preview.kitchenId)!
        const candidate=data.role==='chef'?k.chefId:dinerOwner(state,k)
        if(preview.type==='long'&&candidate&&['lin','chen'].includes(candidate)&&!this.row(candidate))id=candidate
      }
      const color=data.role==='chef'?'#64856c':'#bd7658'
      ;(state.people??={})[id]={name:data.nickname,short:[...data.nickname][0],color}
      this.store.db.prepare('INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)').run(id,data.nickname)
      this.store.db.prepare('UPDATE users SET display_name=? WHERE id=?').run(data.nickname,id)
      this.store.db.prepare('INSERT INTO accounts VALUES(?,?,?,?,?,?,?)').run(id,data.username,data.nickname,hash,data.passwordless?1:0,data.role,Date.now())
      // Define the existing diner host once without altering orders, recipes or memberships.
      for(const k of state.kitchens)if(k.dinerOwnerId===undefined)k.dinerOwnerId=dinerOwner(state,k)
      result=this.session(id)
    })
    return result
  }
  async login(raw:unknown,client:string){
    const data=loginSchema.parse(raw),key='login:'+client+':'+data.identifier.toLowerCase();this.limited(key)
    const row=this.store.db.prepare('SELECT * FROM accounts WHERE username=? COLLATE NOCASE OR nickname=? COLLATE NOCASE').get(data.identifier,data.identifier) as unknown as AccountRow|undefined
    if(data.passwordless){if(!row?.passwordless)throw new CommandError('账号不存在或未开启免密码登录',401)}
    else if(!await verifyPassword(data.password??'',row?.password_hash??null))throw new CommandError('账号或密码不正确',401)
    // Password derivation yields; a concurrent password change must not revive an old login.
    const latest=row&&this.row(row.user_id)
    if(!latest||latest.password_hash!==row!.password_hash||latest.passwordless!==row!.passwordless)throw new CommandError('登录设置已更新，请重新登录',401)
    this.attempts.delete(key)
    return this.session(row!.user_id)
  }
  async security(user:Account,raw:unknown){
    this.limited('security:'+user.id)
    const data=securitySchema.parse(raw),row=this.row(user.id)!
    if(!row.passwordless&&!await verifyPassword(data.currentPassword??'',row.password_hash))throw new CommandError('当前密码不正确',400)
    const nextHash=data.passwordless?null:await hashPassword(password.parse(data.newPassword))
    this.store.db.exec('BEGIN IMMEDIATE')
    try {
      const result=this.store.db.prepare('UPDATE accounts SET password_hash=?,passwordless=? WHERE user_id=? AND password_hash IS ? AND passwordless=?').run(nextHash,data.passwordless?1:0,user.id,row.password_hash,row.passwordless)
      if(!result.changes)throw new CommandError('账号设置已更新，请重新登录后再试',409)
      this.store.db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(user.id)
      const session=this.session(user.id)
      this.store.db.exec('COMMIT');this.attempts.delete('security:'+user.id)
      return session
    }catch(error){if(this.store.db.isTransaction)this.store.db.exec('ROLLBACK');throw error}
  }
  invite(id:string,userId?:string){
    const state=this.store.snapshot().state,inv=state.invites.find(i=>i.id===id),now=Date.now()
    if(!inv||inv.revoked||now>=+new Date(inv.expiresAt)||!state.kitchens.some(k=>k.id===inv.kitchenId&&!k.archived))throw new CommandError('邀请不存在、已过期或已撤销，请让主人重新邀请',404)
    const k=state.kitchens.find(k=>k.id===inv.kitchenId)!,m=state.meals.find(m=>m.id===inv.mealId)
    if(inv.type==='temporary'&&(!m||m.status!=='open'||now>=+new Date(m.deadline)||now>=+new Date(m.endsAt)))throw new CommandError('这一餐已停止接受邀请',410)
    const available=(id:string|null|undefined)=>id===userId||!id||(!userId&&['lin','chen'].includes(id)&&!this.row(id))
    return {id:inv.id,kitchenId:k.id,kitchenName:k.name,type:inv.type,expiresAt:inv.expiresAt,mealName:m?.name,mealDate:m?.date,startsAt:m?.startsAt,chefAvailable:inv.type==='long'&&available(k.chefId),dinerAvailable:inv.type==='long'&&available(dinerOwner(state,k))}
  }
}

/** Read projection per member. Raw global snapshots/deltas never cross the HTTP interface. */
export function stateForUser(state:State,userId:string,now=Date.now()):State {
  const activeKitchens=new Set(state.kitchens.filter(k=>!k.archived).map(k=>k.id))
  const managed=new Set(state.kitchens.filter(k=>isKitchenHost(state,userId,k)).map(k=>k.id))
  const memberKitchenIds=new Set(state.members.filter(m=>m.userId===userId&&activeKitchens.has(m.kitchenId)).map(m=>m.kitchenId))
  const grants=state.grants.filter(g=>g.userId===userId&&!g.revoked&&state.meals.some(m=>m.id===g.mealId&&activeKitchens.has(m.kitchenId)&&m.status!=='cancelled'&&(now<+new Date(m.endsAt)||state.orders.some(o=>o.userId===userId&&o.mealId===m.id))))
  const grantedMeals=new Set(grants.map(g=>g.mealId))
  const meals=state.meals.filter(m=>memberKitchenIds.has(m.kitchenId)||grantedMeals.has(m.id)),mealIds=new Set(meals.map(m=>m.id))
  const visibleKitchenIds=new Set([...memberKitchenIds,...meals.map(m=>m.kitchenId)])
  const kitchens=state.kitchens.filter(k=>visibleKitchenIds.has(k.id)).map(k=>({...k,recipeIds:memberKitchenIds.has(k.id)?k.recipeIds:state.grants.some(g=>grantedMeals.has(g.mealId)&&state.meals.some(m=>m.id===g.mealId&&m.kitchenId===k.id&&now<+new Date(m.endsAt)))?k.recipeIds:[]}))
  const recipeIds=new Set([...kitchens.flatMap(k=>k.recipeIds),...state.orders.filter(o=>mealIds.has(o.mealId)).flatMap(o=>o.recipeIds)])
  const orders=state.orders.filter(o=>mealIds.has(o.mealId))
  const members=state.members.filter(m=>visibleKitchenIds.has(m.kitchenId))
  const managedGrants=state.grants.filter(g=>!g.revoked&&g.userId!==userId&&state.meals.some(m=>m.id===g.mealId&&managed.has(m.kitchenId)&&m.status!=='cancelled'&&now<+new Date(m.endsAt)))
  const personIds=new Set([userId,...members.map(m=>m.userId),...orders.map(o=>o.userId),...managedGrants.map(g=>g.userId)])
  return {version:state.version,people:Object.fromEntries([...personIds].map(id=>[id,state.people?.[id]??people[id]??{name:'家人',short:'家',color:'#64856c'}])),
    kitchens,members,grants:[...grants,...managedGrants],meals,orders,
    recipes:state.recipes.filter(r=>recipeIds.has(r.id)||(!r.archived&&!r.id.startsWith('private-'))),
    stock:state.stock.filter(s=>memberKitchenIds.has(s.kitchenId)&&state.kitchens.some(k=>k.id===s.kitchenId&&k.chefId===userId)),
    invites:state.invites.filter(i=>state.kitchens.some(k=>k.id===i.kitchenId&&isKitchenHost(state,userId,k))),
    reviews:(state.reviews??[]).filter(r=>mealIds.has(r.mealId)),
    checked:Object.fromEntries(Object.entries(state.checked).filter(([key])=>meals.some(m=>key.startsWith(m.id+':')))),
    recipeMarks:{signatures:Object.fromEntries(Object.entries(state.recipeMarks?.signatures??{}).filter(([key])=>visibleKitchenIds.has(key))),favorites:Object.fromEntries(Object.entries(state.recipeMarks?.favorites??{}).filter(([key])=>kitchens.some(k=>key===k.id+':'+userId)))},
    feedback:state.feedback.filter(f=>f.userId===userId)}
}
