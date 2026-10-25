import { afterEach, expect, it } from 'vitest'
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import { Store } from './store'
import { initializeBundledCatalog, readBundledCatalog } from './bundled-catalog'
import { commandSchema, type Command } from './commands'
import { coverIsReference, recipeOriginUrl } from '../src/recipe-content'
import { createAppServer } from './http'

const root=fileURLToPath(new URL('../',import.meta.url)),catalog=readBundledCatalog(root)
const cleanups:(()=>void|Promise<void>)[]=[]
afterEach(async()=>{for(const fn of cleanups.splice(0).reverse())await fn()})
function fixture(){const store=new Store(':memory:',{seedDemo:false});cleanups.push(()=>store.close());return store}
const run=(store:Store,actor:string,command:Command)=>store.execute({requestId:randomUUID(),actor,command})

it('reads all local recipes, validates assets and classifies ambiguous covers independently of matched flags',()=>{
  expect(catalog.recipes).toHaveLength(369)
  expect(new Set(catalog.recipes.map(r=>r.id)).size).toBe(369)
  expect(catalog.recipes.reduce<Record<string,number>>((counts,r)=>{const kind=r.coverInfo!.kind;counts[kind]=(counts[kind]??0)+1;return counts},{})).toEqual({original:173,substituted:11,generated:11,illustration:172,uncertain:2})
  for(const recipe of catalog.recipes){
    expect(recipeOriginUrl(recipe)).toBe('https://github.com/Anduin2017/HowToCook')
    expect(recipe.source).toContain('/blob/2b19c9e9ee926fd925a68207a57582a338813f9c/')
    expect(commandSchema.safeParse({type:'recipe.save',kitchenId:'home',value:{...recipe,source:recipe.source??''}}).success).toBe(true)
  }
  const curry=catalog.recipes.find(r=>r.name==='咖喱炒蟹')!,shrimp=catalog.recipes.find(r=>r.name==='干煎阿根廷红虾')!
  expect(curry.art).toBe('placeholder');expect(curry.art).not.toBe(shrimp.art)
  expect(coverIsReference(curry)).toBe(true);expect(coverIsReference(shrimp)).toBe(false)
  expect(catalog.recipes.find(r=>r.name==='清蒸鲈鱼')?.coverInfo?.kind).toBe('original')
})
it('removes unrelated borrowings and uses reviewed finished dishes rather than packaging or preparation images',()=>{
  for(const name of ['响油鳝丝','美式炒蛋','烤鸡翅','草莓冰淇淋','泰国手标红茶','台式卤肉饭'])expect(catalog.recipes.find(r=>r.name===name)?.art).toBe('placeholder')
  for(const name of ['冰粉','梅菜扣肉','茭白炒肉','荔枝肉','荷兰豆炒腊肠','蚝油三鲜菇','手撕包菜','红烧冬瓜']){
    const recipe=catalog.recipes.find(r=>r.name===name)!
    expect(recipe.art).toMatch(/^\/images\/howtocook-[a-f0-9]{64}\.webp$/)
    expect(recipe.coverInfo?.kind).toBe('original')
    expect(decodeURI(recipe.coverInfo!.sourcePageUrl!)).toBe(recipe.source!.split('/').map(decodeURIComponent).join('/'))
    expect(recipe.coverInfo?.license).toBe('The Unlicense')
  }
  const egg=catalog.recipes.find(r=>r.name==='蒸水蛋')!,custard=catalog.recipes.find(r=>r.name==='鸡蛋羹')!
  expect(egg.art).toBe(custard.art);expect(coverIsReference(egg)).toBe(true)
})
it('initializes a clean database without demo recipes and does not reimport after reopen',()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-catalog-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}))
  const path=join(dir,'kitchen.sqlite'),store=new Store(path,{seedDemo:false})
  try{expect(initializeBundledCatalog(store,catalog)).toEqual({added:369,enriched:0,total:369})}catch(e){store.close();throw e}
  expect(store.snapshot().state.kitchens).toEqual([])
  expect(store.db.prepare('SELECT * FROM users').all()).toEqual([])
  expect(store.snapshot().state.recipes).toEqual(catalog.recipes)
  const revision=store.revision();store.close()
  const reopened=new Store(path,{seedDemo:false});cleanups.push(()=>reopened.close())
  expect(initializeBundledCatalog(reopened,catalog)).toBeNull()
  expect(reopened.revision()).toBe(revision)
  expect(reopened.snapshot().state.recipes).toEqual(catalog.recipes)
  expect(reopened.db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
})
it('preserves existing menus, stock, orders, archived and private recipes, enriching only cover and origin',()=>{
  const store=new Store(':memory:');cleanups.push(()=>store.close())
  const base=catalog.recipes[0]
  store.update(s=>{
    s.recipes.push({...base,art:'shrimp',origin:undefined,coverInfo:undefined,name:'保留之前的菜名',ingredients:[{name:'已有食材',amount:8,unit:'份',type:'food'}]})
    s.kitchens[0].recipeIds.push(base.id)
    s.recipes.push({...base,id:'private-custom',reviewKey:base.id,art:'/images/linyi-chicken.png',name:'我的私房版本',origin:undefined,coverInfo:undefined})
    s.recipes.push({...catalog.recipes[1],archived:true})
  })
  const before=store.snapshot().state
  initializeBundledCatalog(store,catalog)
  const after=store.snapshot().state
  for(const key of ['kitchens','members','meals','orders','stock','reviews','recipeMarks'] as const)expect(after[key]).toEqual(before[key])
  const enriched=after.recipes.find(r=>r.id===base.id)!
  expect(enriched.name).toBe('保留之前的菜名');expect(enriched.ingredients).toEqual(before.recipes.find(r=>r.id===base.id)!.ingredients)
  expect(enriched.art).toBe(base.art);expect(enriched.coverInfo).toEqual(base.coverInfo)
  expect(after.recipes.find(r=>r.id==='private-custom')).toMatchObject({art:'/images/linyi-chicken.png',name:'我的私房版本',origin:base.origin})
  expect(after.recipes.find(r=>r.id===catalog.recipes[1].id)?.archived).toBe(true)
})
it('backs up existing on-disk data before the first catalog install',()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-catalog-backup-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}))
  const store=new Store(join(dir,'kitchen.sqlite'));cleanups.push(()=>store.close())
  const before=store.snapshot().state
  initializeBundledCatalog(store,catalog)
  const backups=readdirSync(join(dir,'backups'));expect(backups).toHaveLength(1)
  const backup=new Store(join(dir,'backups',backups[0]));try{expect(backup.snapshot().state).toEqual(before)}finally{backup.close()}
})
it('upgrades tracked covers on existing public and private recipes while preserving custom covers and business data',()=>{
  const store=new Store(':memory:');cleanups.push(()=>store.close())
  const original=JSON.parse(readFileSync(resolve(root,'content/howtocook/manifest.json'),'utf8'))
  const curry=catalog.recipes.find(r=>r.name==='咖喱炒蟹')!,pork=catalog.recipes.find(r=>r.name==='梅菜扣肉')!
  const oldVersion=(recipe:typeof curry)=>{
    const row=original.recipes.find((r:{recipeId:string})=>r.recipeId===recipe.id)
    const art='/images/howtocook-'+row.cover.sha256+'.webp'
    return {...recipe,art,coverInfo:{art,kind:'substituted' as const},name:'保留我的菜名',steps:['保留我的步骤']}
  }
  store.update(s=>{
    s.bundledCatalog='previous-catalog-version'
    s.recipes.push(oldVersion(curry),oldVersion(pork))
    s.recipes.push({...oldVersion(pork),id:'private-inherited',reviewKey:pork.id})
    s.recipes.push({...oldVersion(pork),id:'private-chosen',reviewKey:pork.id,art:'/images/linyi-chicken.png',coverInfo:undefined})
    // Choosing an illustration is also a user cover choice, and must not be replaced.
    s.recipes.push({...oldVersion(pork),id:'private-illustration',reviewKey:pork.id,art:'greens',coverInfo:undefined})
    s.kitchens[0].recipeIds.push(curry.id,'private-inherited','private-chosen','private-illustration')
  })
  const before=store.snapshot().state
  initializeBundledCatalog(store,catalog)
  const after=store.snapshot().state
  for(const key of ['kitchens','members','meals','orders','stock','reviews','recipeMarks'] as const)expect(after[key]).toEqual(before[key])
  for(const [id,art] of [[curry.id,'placeholder'],[pork.id,pork.art],['private-inherited',pork.art],['private-chosen','/images/linyi-chicken.png'],['private-illustration','greens']]){
    const recipe=after.recipes.find(r=>r.id===id)!
    expect(recipe).toMatchObject({art,name:'保留我的菜名',steps:['保留我的步骤']})
  }
  expect(after.recipes.find(r=>r.id==='private-inherited')?.coverInfo).toEqual(pork.coverInfo)
  const revision=store.revision();expect(initializeBundledCatalog(store,catalog)).toBeNull();expect(store.revision()).toBe(revision)
})
it('backs up an existing catalog before applying corrections, with the old cover recoverable',()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-cover-backup-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}))
  const store=new Store(join(dir,'kitchen.sqlite'));cleanups.push(()=>store.close())
  const recipe=catalog.recipes.find(r=>r.name==='咖喱炒蟹')!
  store.update(s=>{s.bundledCatalog='previous';s.recipes.push({...recipe,art:catalog.managedCovers[recipe.id].find(a=>a.startsWith('/images/'))!})})
  const before=store.snapshot().state
  initializeBundledCatalog(store,catalog)
  const backup=new Store(join(dir,'backups',readdirSync(join(dir,'backups'))[0]))
  try{expect(backup.snapshot().state).toEqual(before)}finally{backup.close()}
  expect(store.snapshot().state.recipes.find(r=>r.id===recipe.id)?.art).toBe('placeholder')
})
it('keeps attribution and reference semantics through private edits and clears an original flag on cover change',()=>{
  const store=fixture();initializeBundledCatalog(store,catalog)
  const kitchenId=run(store,'chen',{type:'kitchen.create',name:'测试厨房',role:'chef'}).result.id
  const recipe=catalog.recipes.find(r=>r.coverInfo?.kind==='original')!
  run(store,'chen',{type:'recipe.add',kitchenId,recipeId:recipe.id})
  const edited=run(store,'chen',{type:'recipe.save',kitchenId,oldId:recipe.id,value:{...recipe,source:'https://example.com/new',name:'我的做法'}}).result.id
  let current=store.snapshot().state.recipes.find(r=>r.id===edited)!
  expect(current.origin).toEqual(recipe.origin);expect(coverIsReference(current)).toBe(false)
  expect(recipeOriginUrl(current)).toBe('https://github.com/Anduin2017/HowToCook')
  const changed=run(store,'chen',{type:'recipe.cover',kitchenId,recipeId:edited,cover:'/images/linyi-chicken.png'}).result.id
  current=store.snapshot().state.recipes.find(r=>r.id===changed)!
  expect(coverIsReference(current)).toBe(true);expect(current.origin).toEqual(recipe.origin)
  expect(store.snapshot().state.recipes.find(r=>r.id===edited)?.art).toBe(recipe.art)
})
it('rejects tampered bundled manifest before any database write',()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-bad-bundle-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}))
  const folder=join(dir,'content/howtocook');mkdirSync(folder,{recursive:true})
  copyFileSync(resolve(root,'content/howtocook/bundle.json'),join(folder,'bundle.json'))
  const raw=readFileSync(resolve(root,'content/howtocook/manifest.json'))
  // Whitespace changes still parse, but must fail byte-integrity verification.
  writeFileSync(join(folder,'manifest.json'),Buffer.concat([raw,Buffer.from(' ')]))
  expect(()=>readBundledCatalog(dir)).toThrow('校验失败')
})
it('rejects a corrupted replacement photo before an existing database can be changed',()=>{
  const dir=mkdtempSync(join(tmpdir(),'yican-bad-cover-'));cleanups.push(()=>rmSync(dir,{recursive:true,force:true}))
  cpSync(resolve(root,'content/howtocook'),join(dir,'content/howtocook'),{recursive:true})
  cpSync(resolve(root,'public/images'),join(dir,'public/images'),{recursive:true})
  const recipe=catalog.recipes.find(r=>r.name==='冰粉')!
  writeFileSync(join(dir,'public',recipe.art.slice(1)),Buffer.from('invalid webp'))
  expect(()=>readBundledCatalog(dir)).toThrow('修正封面校验失败')
})
it('serves bundled images locally with image/webp content type',async()=>{
  const store=fixture(),server=createAppServer(store,resolve(root,'public'))
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  cleanups.push(async()=>{await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections()})})
  const recipe=catalog.recipes.find(r=>r.art.startsWith('/images/'))!
  const response=await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${recipe.art}`)
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('image/webp')
  expect(Buffer.from(await response.arrayBuffer())).toEqual(readFileSync(resolve(root,'public',recipe.art.slice(1))))
})
