import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import type { Recipe, RecipeCoverInfo, State } from '../src/domain'
import { howToCookRepository } from '../src/recipe-content'
import { parseRecipe } from './howtocook'
import type { Store } from './store'

const sha=z.string().regex(/^[a-f0-9]{64}$/)
const manifestSchema=z.object({
  format:z.literal('yican.howtocook.bundle'),schemaVersion:z.literal(1),recipeCount:z.number().int(),imageCount:z.number().int(),
  source:z.object({repository:z.literal(howToCookRepository),commit:z.string().regex(/^[a-f0-9]{40}$/),licenseFile:z.string()}),
  recipes:z.array(z.object({recipeId:z.string().regex(/^howtocook-[a-f0-9]{20}$/),sourcePath:z.string(),markdownFile:z.string(),markdownSha256:sha,
    cover:z.object({sha256:sha,file:z.string(),bytes:z.number().int().positive(),width:z.number().int().positive(),height:z.number().int().positive(),sourceKind:z.enum(['repository','external']),sourcePageUrl:z.string(),sourceImageUrl:z.string(),license:z.string(),licenseUrl:z.string(),matchReason:z.string()}).nullable()}))
})
const sha256=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex')
const defaultRoot=fileURLToPath(new URL('../',import.meta.url))
const builtinArt=new Set(['tomato','beef','shrimp','soup','greens','tofu'])
const coverDecisionSchema=z.discriminatedUnion('action',[
  z.object({action:z.literal('remove'),reason:z.string().min(1)}),
  z.object({action:z.literal('keep'),reason:z.string().min(1)}),
  z.object({action:z.literal('replace'),reason:z.string().min(1),cover:z.object({
    sha256:sha,bytes:z.number().int().positive(),width:z.number().int().positive().max(960),height:z.number().int().positive().max(960),
    kind:z.enum(['original','substituted']),sourcePageUrl:z.url(),sourceImageUrl:z.url(),license:z.string().min(1),licenseUrl:z.url(),
    upstreamBlobSha:z.string().regex(/^[a-f0-9]{40}$/).optional(),
  })}),
])
export interface BundledCatalog { version:string; recipes:Recipe[]; managedCovers:Record<string,string[]> }

function readWithin(root:string,path:string){
  if(path.includes('\\')||path.includes(':')||path.split('/').some(part=>part==='..'||!part))throw new Error('菜谱包路径无效：'+path)
  const file=resolve(root,path)
  if(!file.startsWith(resolve(root)+sep))throw new Error('菜谱包路径越界：'+path)
  return readFileSync(file)
}

/** Read and validate local assets only; startup never fetches external images or recipes. */
export function readBundledCatalog(root=defaultRoot):BundledCatalog {
  const folder=resolve(root,'content/howtocook'),raw=readWithin(folder,'manifest.json'),manifest=manifestSchema.parse(JSON.parse(raw.toString('utf8')))
  const bundle=z.object({manifestSha256:sha,licenseSha256:sha,archiveSha256:sha,recipeCount:z.number().int(),uniqueImages:z.number().int()}).parse(JSON.parse(readWithin(folder,'bundle.json').toString('utf8')))
  if(sha256(raw)!==bundle.manifestSha256||sha256(readWithin(folder,manifest.source.licenseFile))!==bundle.licenseSha256)throw new Error('内置菜谱清单或许可证校验失败')
  const reviewBytes=readWithin(folder,'cover-review.json')
  const review=z.object({archiveSha256:sha,items:z.record(z.string(),z.object({status:z.enum(['reject','needs_review']),reason:z.string()}))}).parse(JSON.parse(reviewBytes.toString('utf8')))
  if(review.archiveSha256!==bundle.archiveSha256)throw new Error('封面复核记录与菜谱包不一致')
  const correctionBytes=readWithin(folder,'cover-corrections.json')
  const corrections=z.object({schemaVersion:z.literal(1),archiveSha256:sha,previousImages:z.record(z.string(),z.array(sha)).default({}),items:z.record(z.string(),coverDecisionSchema)}).parse(JSON.parse(correctionBytes.toString('utf8')))
  if(corrections.archiveSha256!==bundle.archiveSha256)throw new Error('封面修正记录与菜谱包不一致')
  const manifestIds=new Set(manifest.recipes.map(row=>row.recipeId))
  if([...Object.keys(corrections.items),...Object.keys(corrections.previousImages)].some(id=>!manifestIds.has(id)))throw new Error('封面修正记录含未知菜谱')
  const rejectedHashes=new Set(manifest.recipes.filter(r=>review.items[r.recipeId]?.status==='reject').map(r=>r.cover?.sha256))
  const images=new Set<string>(),ids=new Set<string>(),managedCovers:Record<string,string[]>={}
  const recipes=manifest.recipes.map(row=>{
    if(ids.has(row.recipeId)||row.markdownFile!=='source/'+row.sourcePath)throw new Error('菜谱包存在重复标识或路径错误')
    ids.add(row.recipeId)
    const bytes=readWithin(folder,row.markdownFile)
    if(sha256(bytes)!==row.markdownSha256)throw new Error('菜谱原文校验失败：'+row.recipeId)
    const recipe=parseRecipe(row.sourcePath,bytes.toString('utf8'))
    if(!recipe||recipe.id!==row.recipeId)throw new Error('菜谱无法解析：'+row.recipeId)
    const legacyArt=recipe.art
    recipe.origin={provider:'howtocook',repository:howToCookRepository,commit:manifest.source.commit,path:row.sourcePath}
    recipe.source=`${howToCookRepository}/blob/${manifest.source.commit}/${row.sourcePath.split('/').map(encodeURIComponent).join('/')}`
    const cover=row.cover
    recipe.art='placeholder'
    let info:RecipeCoverInfo={art:recipe.art,kind:'illustration',matchReason:'暂缺合适成品图，使用统一占位'}
    if(cover){
      const art='/images/howtocook-'+cover.sha256+'.webp'
      if(!images.has(cover.sha256)){
        const image=readWithin(resolve(root,'public'),art.slice(1))
        if(sha256(image)!==cover.sha256||image.length!==cover.bytes||image.toString('ascii',0,4)!=='RIFF'||image.toString('ascii',8,12)!=='WEBP')throw new Error('菜谱封面校验失败：'+row.recipeId)
        images.add(cover.sha256)
      }
      const reviewResult=review.items[row.recipeId]
      const ownPage=`${howToCookRepository}/blob/${manifest.source.commit}/${row.sourcePath}`
      let originalPage=false
      try{originalPage=decodeURI(cover.sourcePageUrl)===ownPage}catch{}
      const kind:RecipeCoverInfo['kind']=cover.sourceKind==='external'?'generated':!originalPage||cover.matchReason.startsWith('替代')?'substituted':reviewResult?'uncertain':'original'
      if(rejectedHashes.has(cover.sha256))info={art:recipe.art,kind:'illustration',matchReason:reviewResult?.reason??'封面为过程或原料图，暂不展示'}
      else {recipe.art=art;info={art,kind,sourcePageUrl:cover.sourcePageUrl,sourceImageUrl:cover.sourceImageUrl,license:cover.license,licenseUrl:cover.licenseUrl,matchReason:reviewResult?.reason??cover.matchReason}}
    }
    const correction=corrections.items[row.recipeId]
    if(correction?.action==='keep')info.matchReason=correction.reason
    else if(correction?.action==='remove'){
      recipe.art='placeholder';info={art:recipe.art,kind:'illustration',matchReason:correction.reason}
    } else if(correction?.action==='replace'){
      const replacement=correction.cover,art='/images/howtocook-'+replacement.sha256+'.webp'
      const image=readWithin(resolve(root,'public'),art.slice(1))
      if(sha256(image)!==replacement.sha256||image.length!==replacement.bytes||image.toString('ascii',0,4)!=='RIFF'||image.toString('ascii',8,12)!=='WEBP')throw new Error('修正封面校验失败：'+row.recipeId)
      recipe.art=art
      info={art,kind:replacement.kind,sourcePageUrl:replacement.sourcePageUrl,sourceImageUrl:replacement.sourceImageUrl,license:replacement.license,licenseUrl:replacement.licenseUrl,matchReason:correction.reason}
    }
    managedCovers[row.recipeId]=[...new Set([legacyArt,'placeholder',recipe.art,...(cover?['/images/howtocook-'+cover.sha256+'.webp']:[]),...(corrections.previousImages[row.recipeId]??[]).map(hash=>'/images/howtocook-'+hash+'.webp')])]
    recipe.coverInfo=info
    return recipe
  })
  if(recipes.length!==manifest.recipeCount||recipes.length!==bundle.recipeCount||images.size!==bundle.uniqueImages||manifest.recipes.filter(r=>r.cover).length!==manifest.imageCount)throw new Error('内置菜谱或图片数量不完整')
  return {version:'howtocook-v1-'+sha256(Buffer.concat([raw,reviewBytes,correctionBytes])),recipes,managedCovers}
}

/** Install once per bundle, preserving user content, menu choices and historical versions. */
export function installBundledCatalog(state:State,catalog:BundledCatalog){
  const fresh=!state.kitchens.length&&!state.orders.length&&state.recipes.every(r=>builtinArt.has(r.id))
  if(fresh)state.recipes=[]
  const byId=new Map(state.recipes.map(r=>[r.id,r])),incomingById=new Map(catalog.recipes.map(r=>[r.id,r]))
  let added=0,enriched=0
  for(const incoming of catalog.recipes){
    const old=byId.get(incoming.id)
    if(!old){state.recipes.push(incoming);added++;continue}
    // Add provenance/cover only to the known public imports, never to private or unrelated content.
    if(old.archived||!old.source?.startsWith(howToCookRepository+'/blob/'))continue
    old.origin??=incoming.origin
    if(builtinArt.has(old.art)||catalog.managedCovers[incoming.id]?.includes(old.art)){old.art=incoming.art;old.coverInfo=incoming.coverInfo}
    enriched++
  }
  // Only a tracked, inherited cover follows corrections. A user-selected cover has no such metadata.
  for(const recipe of state.recipes){
    const base=incomingById.get(recipe.reviewKey??recipe.id)
    if(base&&recipe.id.startsWith('private-')){
      recipe.origin??=base.origin
      if(recipe.coverInfo?.art===recipe.art&&catalog.managedCovers[base.id]?.includes(recipe.art)){
        recipe.art=base.art;recipe.coverInfo=base.coverInfo
      } else if(!recipe.coverInfo&&recipe.art===base.art)recipe.coverInfo=base.coverInfo
    }
  }
  state.bundledCatalog=catalog.version
  return {added,enriched,total:catalog.recipes.length}
}

export function initializeBundledCatalog(store:Store,catalog=readBundledCatalog()){
  const before=store.snapshot().state
  if(before.bundledCatalog===catalog.version)return null
  if(before.kitchens.length||before.orders.length||before.recipes.some(r=>r.id.startsWith('private-'))){
    const row=store.db.prepare('PRAGMA database_list').all().find(row=>row.name==='main')
    if(row?.file){
      const folder=resolve(dirname(String(row.file)),'backups');mkdirSync(folder,{recursive:true})
      const path=resolve(folder,`pre-bundled-catalog-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`)
      store.db.prepare('VACUUM INTO ?').run(path)
    }
  }
  return store.update(state=>state.bundledCatalog===catalog.version?null:installBundledCatalog(state,catalog))
}
