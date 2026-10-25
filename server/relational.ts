import { DatabaseSync, type SQLInputValue, type StatementSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { createSeed } from '../src/seed'
import { emptyMarks } from '../src/preferences'
import { people, type State } from '../src/domain'
import { collections, recordKey, type Collection, type RecordValue, type StateChange } from '../src/sync'

const fields = (value:string) => value.split(' ')
const specs:Record<Collection,{table:string;fields:string[];nested?:string[]}>={
  kitchens:{table:'kitchens',fields:fields('id name subtitle chefId ownerId chefLabel dinerLabel'),nested:['recipeIds']},
  members:{table:'memberships',fields:fields('userId kitchenId role')},
  grants:{table:'meal_grants',fields:fields('mealId userId revoked')},
  recipes:{table:'recipe_versions',fields:fields('id reviewKey name category minutes servings note art source sourceText archived'),nested:['ingredients','steps']},
  meals:{table:'meals',fields:fields('id kitchenId date name startsAt endsAt deadline status'),nested:['portions']},
  orders:{table:'orders',fields:fields('id userId mealId note createdAt'),nested:['recipeIds']},
  stock:{table:'inventory',fields:fields('id kitchenId name amount unit type')},
  invites:{table:'invitations',fields:fields('id kitchenId type mealId expiresAt')},
  reviews:{table:'reviews',fields:fields('id kitchenId mealId userId recipeId recipeKey text createdAt updatedAt')},
  feedback:{table:'feedback',fields:fields('id type text createdAt')}
}
const snake=(name:string)=>name.replace(/[A-Z]/g,c=>'_'+c.toLowerCase())
const json=(v:unknown)=>JSON.stringify(v)
const hash=(v:unknown)=>createHash('sha256').update(json(v)).digest('hex')
export const stateHash=hash
function mismatch(a:any,b:any,path='$'):string {
  if(json(a)===json(b))return ''
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
    if(json(Object.keys(a))!==json(Object.keys(b)))return path+' (字段/顺序不同)'
    for(const key of Object.keys(a)){const found=mismatch(a[key],b[key],path+'.'+key);if(found)return found}
  }
  return path+' (值不同)'
}
const optionalBoolean=new Set(['archived','revoked'])
const shape=(value:RecordValue,known:string[])=>[json(Object.keys(value)),json(Object.fromEntries(Object.entries(value).filter(([k])=>!known.includes(k))))]
function restore(row:RecordValue,columns:string[],nested:RecordValue={}){
  const extras=JSON.parse(row.extra),keys:string[]=JSON.parse(row.shape)
  return Object.fromEntries(keys.map(key=>[key,key in nested?nested[key]:columns.includes(key)?optionalBoolean.has(key)&&row[snake(key)]!==null?!!row[snake(key)]:row[snake(key)]:extras[key]]))
}

export class Relational {
  private statements=new Map<string,StatementSync>()
  constructor(readonly db:DatabaseSync){}
  stmt(sql:string){let s=this.statements.get(sql);if(!s){s=this.db.prepare(sql);this.statements.set(sql,s)}return s}
  run(sql:string,...values:SQLInputValue[]){return this.stmt(sql).run(...values)}
  rows(sql:string,...values:SQLInputValue[]):RecordValue[]{return this.stmt(sql).all(...values)}
  meta(){return this.stmt('SELECT * FROM app_meta WHERE id=1').get() as {revision:number;state_keys:string}}
  private users(state:State){
    const ids=new Set(Object.keys(state.people??{}))
    for(const list of [state.kitchens,state.members,state.grants,state.orders,state.reviews??[]])for(const row of list)for(const field of ['userId','chefId','ownerId'])if((row as RecordValue)[field])ids.add((row as RecordValue)[field])
    for(const id of ids)this.run('INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)',id,state.people?.[id]?.name??people[id]?.name??id)
  }
  private rowUsers(row:RecordValue){for(const key of ['userId','chefId','ownerId'])if(row[key])this.run('INSERT OR IGNORE INTO users(id,display_name) VALUES(?,?)',row[key],people[row[key]]?.name??row[key])}
  private maxOrder(table:string){return Number((this.stmt(`SELECT COALESCE(MAX(sort_order),-1) AS n FROM ${table}`).get() as RecordValue).n)}
  private saveRow(name:Collection,row:RecordValue,previous?:RecordValue){
    const spec=specs[name],columns=spec.fields.map(snake),key=recordKey(name,row)
    this.rowUsers(row)
    if(name==='recipes')this.run('INSERT OR IGNORE INTO recipes(id) VALUES(?)',row.reviewKey??row.id)
    if(name==='reviews'&&row.recipeKey)this.run('INSERT OR IGNORE INTO recipes(id) VALUES(?)',row.recipeKey)
    const old=this.stmt(`SELECT sort_order FROM ${spec.table} WHERE row_key=?`).get(key) as RecordValue|undefined
    const values=spec.fields.map(field=>name==='recipes'&&field==='reviewKey'?row.reviewKey??row.id:row[field]===undefined?null:typeof row[field]==='boolean'?Number(row[field]):row[field])
    const [keys,extra]=shape(row,[...spec.fields,...spec.nested??[]])
    this.run(`INSERT INTO ${spec.table}(row_key,${columns.join(',')},sort_order,shape,extra) VALUES(${Array(columns.length+4).fill('?').join(',')}) ON CONFLICT(row_key) DO UPDATE SET ${columns.map(c=>`${c}=excluded.${c}`).join(',')},shape=excluded.shape,extra=excluded.extra`,key,...values,old?.sort_order??this.maxOrder(spec.table)+1,keys,extra)
    if(name==='recipes'){
      if(!previous||row.ingredients!==previous.ingredients){
        this.run('DELETE FROM recipe_ingredients WHERE recipe_id=?',row.id)
        row.ingredients.forEach((i:RecordValue,pos:number)=>{const [keys,extra]=shape(i,fields('name amount unit type'));this.run('INSERT INTO recipe_ingredients VALUES(?,?,?,?,?,?,?,?)',row.id,pos,i.name,i.amount,i.unit,i.type,keys,extra)})
      }
      if(!previous||row.steps!==previous.steps){this.run('DELETE FROM recipe_steps WHERE recipe_id=?',row.id);row.steps.forEach((step:string,pos:number)=>this.run('INSERT INTO recipe_steps VALUES(?,?,?)',row.id,pos,step))}
    }
    if((name==='kitchens'||name==='orders')&&(!previous||row.recipeIds!==previous.recipeIds)){
      const table=name==='kitchens'?'kitchen_menu':'order_items',fk=name==='kitchens'?'kitchen_id':'order_id'
      this.run(`DELETE FROM ${table} WHERE ${fk}=?`,row.id)
      row.recipeIds.forEach((id:string,pos:number)=>this.run(`INSERT INTO ${table} VALUES(?,?,?)`,row.id,pos,id))
    }
    if(name==='meals'&&(!previous||row.portions!==previous.portions)){
      this.run('DELETE FROM meal_portions WHERE meal_id=?',row.id)
      Object.entries(row.portions).forEach(([id,qty],pos)=>this.run('INSERT INTO meal_portions VALUES(?,?,?,?)',row.id,id,qty as number,pos))
    }
  }
  private saveChecked(before:State,after:State){
    if(before.checked===after.checked)return
    for(const key of Object.keys(before.checked??{}))if(!(key in after.checked))this.run('DELETE FROM shopping_checks WHERE key=?',key)
    let next=Number((this.stmt('SELECT COALESCE(MAX(position),-1)+1 AS n FROM shopping_checks').get() as RecordValue).n)
    for(const [key,value] of Object.entries(after.checked))if(value!==before.checked?.[key]){
      const mealId=after.meals.find(m=>key.startsWith(m.id+':'))?.id??null
      this.run('INSERT INTO shopping_checks VALUES(?,?,?,?) ON CONFLICT(key) DO UPDATE SET meal_id=excluded.meal_id,signature=excluded.signature',key,mealId,value,next++)
    }
  }
  private saveMarks(before:State,after:State){
    if(before.recipeMarks===after.recipeMarks)return
    for(const kind of ['signatures','favorites'] as const){
      const a=before.recipeMarks?.[kind]??{},b=after.recipeMarks?.[kind]??{}
      if(a===b)continue
      for(const key of Object.keys(a))if(!(key in b))this.run('DELETE FROM mark_groups WHERE kind=? AND key=?',kind,key)
      let pos=Number((this.stmt('SELECT COALESCE(MAX(position),-1)+1 AS n FROM mark_groups WHERE kind=?').get(kind) as RecordValue).n)
      for(const [key,ids] of Object.entries(b))if(a[key]!==ids){
        const kitchenId=after.kitchens.find(k=>kind==='signatures'?key===k.id:key.startsWith(k.id+':'))?.id??null
        const userId=kind==='favorites'&&kitchenId?key.slice(kitchenId.length+1):null
        if(userId)this.run('INSERT OR IGNORE INTO users VALUES(?,?)',userId,people[userId]?.name??userId)
        this.run('INSERT INTO mark_groups VALUES(?,?,?,?,?) ON CONFLICT(kind,key) DO UPDATE SET kitchen_id=excluded.kitchen_id,user_id=excluded.user_id',kind,key,kitchenId,userId,pos++)
        this.run('DELETE FROM recipe_marks WHERE kind=? AND key=?',kind,key)
        ids.forEach((id,i)=>this.run('INSERT INTO recipe_marks VALUES(?,?,?,?)',kind,key,i,id))
      }
    }
  }
  write(before:State,after:State,change:StateChange,revision:number){
    for(const name of collections){
      const update=change.arrays[name],spec=specs[name]
      if(change.removed.includes(name))this.run(`DELETE FROM ${spec.table}`)
      if(!update)continue
      const old=new Map(((before as RecordValue)[name]??[]).map((r:RecordValue)=>[recordKey(name,r),r]))
      for(const key of update.remove)this.run(`DELETE FROM ${spec.table} WHERE row_key=?`,key)
      for(const row of update.upsert)this.saveRow(name,row,old.get(recordKey(name,row)) as RecordValue|undefined)
      if(update.order)update.order.forEach((key,pos)=>this.run(`UPDATE ${spec.table} SET sort_order=? WHERE row_key=?`,pos,key))
    }
    this.saveChecked(before,after);this.saveMarks(before,after)
    const extras=(s:State)=>Object.fromEntries(Object.entries(s).filter(([k])=>!collections.includes(k as Collection)&&k!=='checked').map(([k,v])=>[k,k==='recipeMarks'?{keys:Object.keys(v),extra:Object.fromEntries(Object.entries(v).filter(([key])=>!['signatures','favorites'].includes(key)))}:v]))
    const a=extras(before),b=extras(after)
    for(const key of Object.keys(a))if(!(key in b))this.run('DELETE FROM state_extensions WHERE key=?',key)
    for(const [key,value] of Object.entries(b))if(json(a[key])!==json(value))this.run('INSERT INTO state_extensions VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',key,json(value))
    this.run('INSERT INTO app_meta VALUES(1,?,?,2) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,state_keys=excluded.state_keys',revision,json(Object.keys(after)))
  }
  read():State {
    const lists:RecordValue={}
    const group=(sql:string,key:string)=>{const map=new Map<string,RecordValue[]>();for(const r of this.rows(sql)){const list=map.get(r[key])??[];list.push(r);map.set(r[key],list)}return map}
    const ingredients=group('SELECT * FROM recipe_ingredients ORDER BY recipe_id,position','recipe_id'),steps=group('SELECT * FROM recipe_steps ORDER BY recipe_id,position','recipe_id'),menu=group('SELECT * FROM kitchen_menu ORDER BY kitchen_id,position','kitchen_id'),items=group('SELECT * FROM order_items ORDER BY order_id,position','order_id'),portions=group('SELECT * FROM meal_portions ORDER BY meal_id,position','meal_id')
    for(const name of collections){const spec=specs[name];lists[name]=this.rows(`SELECT * FROM ${spec.table} ORDER BY sort_order`).map(row=>{
      const nested:RecordValue={}
      if(name==='recipes'){nested.ingredients=(ingredients.get(row.id)??[]).map(i=>restore(i,fields('name amount unit type')));nested.steps=(steps.get(row.id)??[]).map(s=>s.instruction)}
      if(name==='kitchens')nested.recipeIds=(menu.get(row.id)??[]).map(r=>r.recipe_id)
      if(name==='orders')nested.recipeIds=(items.get(row.id)??[]).map(r=>r.recipe_id)
      if(name==='meals')nested.portions=Object.fromEntries((portions.get(row.id)??[]).map(r=>[r.recipe_id,r.quantity]))
      return restore(row,spec.fields,nested)
    })}
    lists.checked=Object.fromEntries(this.rows('SELECT * FROM shopping_checks ORDER BY position').map(r=>[r.key,r.signature]))
    for(const row of this.rows('SELECT * FROM state_extensions'))lists[row.key]=JSON.parse(row.value)
    if(lists.recipeMarks){
      const meta=lists.recipeMarks,parts:RecordValue={signatures:{},favorites:{},...meta.extra}
      const entries=group("SELECT *,kind||':'||key AS group_key FROM recipe_marks ORDER BY kind,key,position",'group_key')
      for(const row of this.rows('SELECT * FROM mark_groups ORDER BY position'))parts[row.kind][row.key]=(entries.get(row.kind+':'+row.key)??[]).map(r=>r.recipe_id)
      lists.recipeMarks=Object.fromEntries(meta.keys.map((k:string)=>[k,parts[k]]))
    }
    return Object.fromEntries(JSON.parse(this.meta().state_keys).map((key:string)=>[key,lists[key]])) as unknown as State
  }
  initialize(seedDemo=true){
    const exists=(table:string)=>!!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
    if(exists('app_meta')){if((this.db.prepare('PRAGMA user_version').get() as RecordValue).user_version!==2)throw new Error('不支持的数据库版本');return}
    this.db.exec('BEGIN IMMEDIATE')
    try {
      // Re-check after acquiring the write lock, in case another process migrated first.
      if(exists('app_meta')){this.db.exec('COMMIT');return}
      const legacy=exists('kitchen_state')?this.db.prepare('SELECT revision,body FROM kitchen_state WHERE id=1').get() as {revision:number;body:string}|undefined:undefined
      if(exists('kitchen_state')&&!legacy)throw new Error('旧数据库缺少状态，已停止迁移')
      const state:State=legacy?JSON.parse(legacy.body):{...createSeed(),recipeMarks:emptyMarks()}
      if(!legacy&&!seedDemo){state.kitchens=[];state.members=[];state.meals=[];state.orders=[];state.stock=[];state.people={}}
      this.db.exec(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
      for(const spec of Object.values(specs))this.db.exec(`CREATE INDEX ${spec.table}_sequence ON ${spec.table}(sort_order)`)
      this.users(state)
      const empty={checked:{}} as State
      const arrays:StateChange['arrays']={};for(const name of collections)if((state as RecordValue)[name])arrays[name]={upsert:(state as RecordValue)[name],remove:[]}
      this.write(empty,state,{arrays,values:{},removed:[]},legacy?.revision??1)
      const restored=this.read(),before=hash(state),after=hash(restored)
      if(before!==after)throw new Error('迁移往返数据校验失败，已回滚：'+mismatch(state,restored))
      if(this.rows('PRAGMA foreign_key_check').length)throw new Error('迁移检测到失效引用，已回滚')
      this.run('INSERT INTO migration_audit VALUES(2,?,?,?,?)',new Date().toISOString(),before,after,json(Object.fromEntries(collections.map(k=>[k,(state as RecordValue)[k]?.length??0]))))
      if(legacy){
        this.db.exec('ALTER TABLE kitchen_state RENAME TO legacy_kitchen_state; CREATE TRIGGER legacy_state_readonly_update BEFORE UPDATE ON legacy_kitchen_state BEGIN SELECT RAISE(ABORT,\'旧状态已封存，请使用新业务表\'); END; CREATE TRIGGER legacy_state_readonly_delete BEFORE DELETE ON legacy_kitchen_state BEGIN SELECT RAISE(ABORT,\'旧状态已封存\'); END;')
      }
      this.db.exec('COMMIT; PRAGMA optimize')
    }catch(error){this.db.exec('ROLLBACK');throw error}
  }
}
