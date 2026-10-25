import type { State } from './domain'

export const collections = ['kitchens','members','grants','recipes','meals','orders','stock','invites','reviews','feedback'] as const
export type Collection = typeof collections[number]
export type RecordValue = Record<string, any>
export function recordKey(name: Collection, value: RecordValue): string {
  if(name==='members') return JSON.stringify([value.kitchenId,value.userId])
  if(name==='grants') return JSON.stringify([value.mealId,value.userId,value.revoked??false])
  return value.id
}
export interface ArrayChange { upsert: RecordValue[]; remove: string[]; order?: string[] }
export interface StateChange {
  arrays: Partial<Record<Collection,ArrayChange>>
  values: Record<string,unknown>
  removed: string[]
  maps?: {path:string[];set:Record<string,unknown>;remove:string[]}[]
}
// Immutable references let unchanged collections (especially recipe Markdown) be skipped.
export function diffState(before: State, after: State): StateChange {
  const a=before as RecordValue,b=after as RecordValue,change:StateChange={arrays:{},values:{},removed:[]}
  for(const name of collections){
    if(a[name]===b[name])continue
    if(!b[name]){change.removed.push(name);continue}
    const old:RecordValue[]=a[name]??[],next:RecordValue[]=b[name]
    const oldMap=new Map(old.map(row=>[recordKey(name,row),row])),nextMap=new Map(next.map(row=>[recordKey(name,row),row]))
    if(nextMap.size!==next.length)throw new Error(`重复记录：${name}`)
    const upsert=next.filter(row=>oldMap.get(recordKey(name,row))!==row),remove=[...oldMap.keys()].filter(key=>!nextMap.has(key))
    const natural=[...oldMap.keys()].filter(key=>nextMap.has(key)).concat([...nextMap.keys()].filter(key=>!oldMap.has(key)))
    const order=[...nextMap.keys()]
    change.arrays[name]={upsert,remove,...(natural.some((key,i)=>key!==order[i])?{order}:{})}
  }
  for(const key of Object.keys(b))if(!collections.includes(key as Collection)&&a[key]!==b[key]){
    const paths=key==='checked'&&a[key]?[['checked']]:key==='recipeMarks'&&a[key]&&JSON.stringify(Object.keys(a[key]))===JSON.stringify(Object.keys(b[key]))?[['recipeMarks','signatures'],['recipeMarks','favorites']]:[]
    if(paths.length){
      for(const path of paths){const x=path.reduce((v,k)=>v?.[k],a)??{},y=path.reduce((v,k)=>v?.[k],b)??{}
        if(x===y)continue
        ;(change.maps??=[]).push({path,set:Object.fromEntries(Object.entries(y).filter(([k,v])=>x[k]!==v)),remove:Object.keys(x).filter(k=>!(k in y))})
      }
      // Unknown extension fields in marks must also survive maintenance changes.
      if(key==='recipeMarks'&&Object.keys(b[key]).some(k=>!['signatures','favorites'].includes(k)&&a[key][k]!==b[key][k]))change.values[key]=b[key]
    }else change.values[key]=b[key]
  }
  for(const key of Object.keys(a))if(!(key in b)&&!change.removed.includes(key))change.removed.push(key)
  return change
}
export function applyStateChange(state: State, change: StateChange) {
  for(const [key,value] of Object.entries(change.values))(state as RecordValue)[key]=value
  for(const key of change.removed)delete (state as RecordValue)[key]
  for(const map of change.maps??[]){const object=map.path.reduce((v,k)=>v[k]??=( {} ),state as RecordValue);for(const key of map.remove)delete object[key];Object.assign(object,map.set)}
  for(const name of collections){
    const update=change.arrays[name];if(!update)continue
    const old:RecordValue[]=(state as RecordValue)[name]??[]
    const rows=new Map(old.map(row=>[recordKey(name,row),row]))
    for(const key of update.remove)rows.delete(key)
    for(const row of update.upsert)rows.set(recordKey(name,row),row)
    ;(state as RecordValue)[name]=update.order?update.order.map(key=>rows.get(key)):[...rows.values()]
  }
}
