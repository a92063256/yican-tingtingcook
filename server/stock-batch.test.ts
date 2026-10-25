import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Store } from './store'
import { fingerprint, type Command } from './commands'

const cleanup:(()=>void)[]=[]
afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn()})
function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'yican-stock-')),path=join(directory,'kitchen.sqlite'),store=new Store(path)
  cleanup.push(()=>rmSync(directory,{recursive:true,force:true}),()=>{try{store.close()}catch{}})
  return {store,path}
}
const request=(command:Command,actor='chen')=>({requestId:randomUUID(),actor,command})
const addition=(name:string,amount=1,unit='份',type:'food'|'seasoning'='food')=>({value:{name,amount,unit,type},expected:null as string|null})

it('atomically adds and accumulates inventory, persists across restart and deduplicates a retry',()=>{
  const {store,path}=fixture(),salt=store.snapshot().state.stock.find(x=>x.name==='盐')!
  const command:Command={type:'stock.batch',kitchenId:'home',items:[addition('芹菜',1,'斤'),addition('酱油',1,'瓶','seasoning'),{...addition('盐',20,'克','seasoning'),expected:fingerprint(salt)},addition('猪肉罐头',2)]}
  const envelope=request(command)
  store.execute(envelope);store.execute(envelope)
  const after=store.snapshot().state.stock
  expect(after.find(x=>x.id===salt.id)?.amount).toBe(120)
  expect(after.filter(x=>x.name==='酱油')).toHaveLength(1)
  expect(after.find(x=>x.name==='酱油')).toEqual({...addition('酱油',1,'瓶','seasoning').value,id:expect.any(String),kitchenId:'home'})
  store.close();const reopened=new Store(path);cleanup.push(()=>reopened.close())
  reopened.execute(envelope)
  expect(reopened.snapshot().state.stock).toEqual(after)
})
it('rejects a stale target and commits none of the batch',()=>{
  const {store}=fixture(),salt=store.snapshot().state.stock.find(x=>x.name==='盐')!
  store.execute(request({type:'stock.save',kitchenId:'home',id:salt.id,value:{...salt,amount:99},expected:fingerprint(salt)}))
  const before=store.snapshot()
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[addition('芹菜'),{...addition('盐',2,'克','seasoning'),expected:fingerprint(salt)}]}))).toThrow('另一台设备')
  expect(store.snapshot()).toMatchObject({revision:before.revision,state:before.state})
})
it('rejects non-chefs, unknown existing quantities, conflicting categories and duplicate targets',()=>{
  const {store}=fixture(),before=store.snapshot(),unknown=before.state.stock.find(x=>x.amount===null)!
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[addition('芹菜')]},'lin'))).toThrow('主厨')
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[addition('芹菜'),{...addition(unknown.name,1,unknown.unit),expected:fingerprint(unknown)}]}))).toThrow('原数量待确认')
  const salt=before.state.stock.find(x=>x.name==='盐')!
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[{...addition('盐',1,'克'),expected:fingerprint(salt)}]}))).toThrow('分类')
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[addition('芹菜'),addition('芹菜')]}))).toThrow('合并')
  expect(()=>store.execute(request({type:'stock.batch',kitchenId:'home',items:[addition('芹菜',.00001)]}))).toThrow('至少')
  expect(store.snapshot()).toMatchObject({revision:before.revision,state:before.state})
})
it('isolates kitchens and never deduces consumption or expiration for seasonings',()=>{
  const {store}=fixture(),before=store.snapshot().state
  store.execute(request({type:'stock.batch',kitchenId:'friends',items:[addition('酱油',1,'瓶','seasoning')]},'lin'))
  const after=store.snapshot().state
  expect(after.stock.filter(x=>x.kitchenId==='home')).toEqual(before.stock.filter(x=>x.kitchenId==='home'))
  const soy=after.stock.find(x=>x.name==='酱油')!
  expect(soy).toEqual({...addition('酱油',1,'瓶','seasoning').value,id:expect.any(String),kitchenId:'friends'})
  store.execute(request({type:'stock.batch',kitchenId:'friends',items:[{...addition('酱油',1,'瓶','seasoning'),expected:fingerprint(soy)}]},'lin'))
  expect(store.snapshot().state.stock.find(x=>x.id===soy.id)?.amount).toBe(2)
})
