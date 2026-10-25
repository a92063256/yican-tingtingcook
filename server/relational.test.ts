import { afterEach, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Store } from './store'
import { createSeed } from '../src/seed'
import { applyStateChange } from '../src/sync'
import { stateHash } from './relational'
import { exportLegacy } from './export-legacy'
import { createAppServer } from './http'
import { fixtureSession } from './test-session'
import { fingerprint, type Command } from './commands'

const cleanups:(()=>void|Promise<void>)[]=[]
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()})
function temp(){const dir=mkdtempSync(join(tmpdir(),'yican-relational-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}));return {dir,path:join(dir,'db.sqlite')}}
function open(path:string){const store=new Store(path);cleanups.push(()=>{try{store.close()}catch{}});return store}
const envelope=(command:Command,actor:'lin'|'chen'|'guest'='chen')=>({requestId:randomUUID(),actor,command})
function legacy(path:string){
 const state=createSeed();state.recipeMarks={signatures:{home:['tomato','soup'],friends:[]},favorites:{'home:lin':['soup','tomato']}}
 state.meals[3].portions={soup:2,tomato:1.5};state.checked[`${state.meals[3].id}:番茄|克`]='no:旧签名'
 state.reviews=[{id:'historical-review',kitchenId:'home',mealId:'home-1-1',userId:'lin',recipeId:'tomato',recipeKey:'tomato',text:'好吃 👨‍👩‍👧‍👦 ❤️\n下次还想吃',createdAt:'2026-01-01T12:00:00Z',updatedAt:'2026-01-01T13:00:00Z'}]
 Object.assign(state,{futureExtension:{nested:['不会丢失',null,0]}});Object.assign(state.recipes[0],{legacyUnknown:{a:'保留扩展'}})
 state.recipes[0].art='/images/linyi-chicken.png';state.recipes[1].minutes=null;state.recipes[2].sourceText='# 菜谱原文\n保留逐字内容'
 const db=new DatabaseSync(path);db.exec('CREATE TABLE kitchen_state(id INTEGER PRIMARY KEY,revision INTEGER,body TEXT); CREATE TABLE requests(id TEXT PRIMARY KEY,body TEXT,result TEXT)')
 db.prepare('INSERT INTO kitchen_state VALUES(1,72,?)').run(JSON.stringify(state));db.prepare('INSERT INTO requests VALUES(?,?,?)').run('old-request','exact request','exact result');db.close();return state
}
it('migrates every field and JSON ordering losslessly, including marks, unknown fields and receipts',()=>{
 const {path,dir}=temp(),original=legacy(path),store=open(path)
 expect(stateHash(store.snapshot().state)).toBe(stateHash(original));expect(store.snapshot().revision).toBe(72)
 expect(store.db.prepare('SELECT * FROM requests').all()).toEqual([{id:'old-request',body:'exact request',result:'exact result'}])
 expect(store.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
 expect(store.db.prepare('SELECT name,amount FROM recipe_ingredients WHERE recipe_id=? ORDER BY position').all('tomato')[0]).toEqual({name:'番茄',amount:300})
 expect(readdirSync(join(dir,'backups')).some(n=>n.startsWith('pre-tables-'))).toBe(true)
 expect(()=>store.db.prepare('UPDATE legacy_kitchen_state SET body=?').run('{}')).toThrow('封存')
 store.close();const again=open(path);expect(stateHash(again.snapshot().state)).toBe(stateHash(original))
 expect(again.db.prepare('SELECT COUNT(*) AS n FROM migration_audit').get()?.n).toBe(1)
})
it('aborts and rolls back bad historical references instead of dropping records',()=>{
 const {path}=temp(),original=legacy(path);original.orders[0].recipeIds.push('missing-historical-recipe')
 const db=new DatabaseSync(path);db.prepare('UPDATE kitchen_state SET body=?').run(JSON.stringify(original));db.close()
 expect(()=>new Store(path)).toThrow()
 const check=new DatabaseSync(path);try{
  expect(check.prepare("SELECT name FROM sqlite_master WHERE name='app_meta'").get()).toBeUndefined()
  expect(JSON.parse(check.prepare('SELECT body FROM kitchen_state').get()!.body as string)).toEqual(original)
 }finally{check.close()}
})
it('writes only changed business rows and leaves recipe content untouched on stock changes',()=>{
 const store=open(':memory:'),before=store.snapshot(),stock=before.state.stock[0]
 store.db.exec("CREATE TRIGGER no_recipe_rewrite BEFORE UPDATE ON recipe_versions BEGIN SELECT RAISE(ABORT,'recipes were rewritten'); END; CREATE TRIGGER no_ingredient_delete BEFORE DELETE ON recipe_ingredients BEGIN SELECT RAISE(ABORT,'ingredients were rewritten'); END;")
 store.execute(envelope({type:'stock.save',kitchenId:'home',id:stock.id,value:{...stock,amount:555},expected:fingerprint(stock)}),before.revision)
 expect(store.db.prepare('SELECT amount FROM inventory WHERE id=?').get(stock.id)?.amount).toBe(555)
 expect(store.snapshot().state.recipes).toEqual(before.state.recipes)
 const delta=store.sync(before.revision);expect(JSON.stringify(delta)).not.toContain('番茄洗净切块')
 expect(JSON.stringify(delta).length).toBeLessThan(1000)
})
it('keeps multi-connection transactions fresh and rejects stale writes after another connection commits',()=>{
 const {path}=temp(),a=open(path),b=open(path),snapshot=a.snapshot(),stock=snapshot.state.stock[0]
 a.execute(envelope({type:'stock.useup',id:stock.id,expected:fingerprint(stock)}))
 expect(()=>b.execute(envelope({type:'stock.useup',id:stock.id,expected:fingerprint(stock)}))).toThrow('另一台设备')
 b.execute(envelope({type:'feedback.save',kind:'建议',text:'来自另一连接'}))
 expect(a.snapshot().state.feedback).toHaveLength(1);expect(b.snapshot().state.stock[0].amount).toBe(0)
})
it('enforces database uniqueness and rolls the entire revision back on foreign-key failures',()=>{
 const store=open(':memory:'),before=store.snapshot()
 expect(()=>store.update(s=>{s.orders.push({...s.orders[0],id:'duplicate-order'})})).toThrow('UNIQUE')
 expect(()=>store.update(s=>{s.orders[0].recipeIds.push('invalid')})).toThrow('FOREIGN KEY')
 expect(store.snapshot()).toMatchObject({state:before.state,revision:before.revision})
 expect(store.db.prepare('SELECT COUNT(*) AS n FROM sync_changes').get()?.n).toBe(0)
})
it('replays small deltas for creation, deletion, edits and marks exactly as a full refresh',()=>{
 const store=open(':memory:'),initial=store.snapshot(),client=initial.state
 store.execute(envelope({type:'recipe.mark',kitchenId:'home',recipeId:'tomato',kind:'signature',marked:true}))
 store.execute(envelope({type:'order.submit',mealId:'home-1-0',recipeIds:['tofu'],note:'新订单',expected:null},'lin'))
 store.execute(envelope({type:'order.cancel',mealId:'home-1-0',expected:fingerprint(store.snapshot().state.orders.find(o=>o.mealId==='home-1-0'))},'lin'))
 store.execute(envelope({type:'recipe.mark',kitchenId:'home',recipeId:'soup',kind:'favorite',marked:true},'lin'))
 store.execute(envelope({type:'recipe.mark',kitchenId:'home',recipeId:'soup',kind:'favorite',marked:false},'lin'))
 const response=store.sync(initial.revision);expect(response.state).toBeUndefined();expect(response.fromRevision).toBe(initial.revision)
 for(const delta of response.changes!)applyStateChange(client,delta)
 expect(client).toEqual(store.snapshot().state)
 expect(store.sync(response.revision)).toEqual({revision:response.revision,serverNow:expect.any(Number)})
 store.db.exec('DELETE FROM sync_changes');store.execute(envelope({type:'feedback.save',kind:'建议',text:'触发下一版本'}));expect(store.sync(initial.revision).state).toBeDefined()
})
it('exports post-migration changes to an old-compatible database for lossless rollback',()=>{
 const {path,dir}=temp();legacy(path);const store=open(path)
 store.execute(envelope({type:'feedback.save',kind:'建议',text:'迁移后新增，回退也不能丢'}))
 const expected=store.snapshot(),out=join(dir,'rollback.sqlite');exportLegacy(path,out)
 const db=new DatabaseSync(out);try{expect(JSON.parse(db.prepare('SELECT body FROM kitchen_state').get()!.body as string)).toEqual(expected.state)}finally{db.close()}
 const migratedAgain=open(out);expect(migratedAgain.snapshot().state).toEqual(expected.state)
})
it('serves authenticated projections and compact unchanged reads without leaking global deltas',async()=>{
 const store=open(':memory:'),server=createAppServer(store,'.')
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));cleanups.push(()=>new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections()}))
 const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`
 const cookie=await fixtureSession(store,base,'chen'),first=await fetch(base+'/api/state',{headers:{Cookie:cookie}}),initial=await first.json()
 const unchanged=await fetch(base+'/api/state?since='+initial.revision,{headers:{Cookie:cookie}})
 expect((await unchanged.text()).length).toBeLessThan(100)
 const condition=await fetch(base+'/api/state',{headers:{Cookie:cookie,'If-None-Match':first.headers.get('ETag')!}});expect(condition.status).toBe(304)
 const changed=await (await fetch(base+'/api/commands?since='+initial.revision,{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1',Cookie:cookie},body:JSON.stringify(envelope({type:'feedback.save',kind:'建议',text:'增量测试'}))})).json()
 expect(changed.changes).toBeUndefined();expect(changed.state.feedback).toHaveLength(1)
 expect(changed.state).toEqual((await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json()).state)
})
