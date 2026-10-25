import { createHash } from 'node:crypto'
import type { Ingredient, Recipe, State } from '../src/domain'

const groups:Record<string,[string,string]>={aquatic:['鱼虾海鲜','shrimp'],breakfast:['早餐','tofu'],condiment:['酱料调味','soup'],dessert:['甜品','tofu'],drink:['饮品','soup'],meat_dish:['荤菜','beef'],'semi-finished':['半成品','tofu'],soup:['汤羹','soup'],staple:['主食','tomato'],vegetable_dish:['素菜','greens']}
const plain=(s:string)=>s.replace(/!\[[^\]]*\]\([^)]*\)/g,'').replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[*`]/g,'').trim()
const seasoning=/盐|糖|酱|醋|油|酒|椒|香料|八角|桂皮|味精|鸡精|淀粉|孜然|香叶/
export function parseRecipe(path:string,text:string):Recipe|null{
 const group=groups[path.split('/')[1]]
 if(!group)return null
 const title=text.match(/^#\s+(.+)$/m)?.[1]
 if(!title)return null
 const sections=new Map<string,string[]>();let section=''
 for(const line of text.replace(/\r/g,'').split('\n')){
  const heading=line.match(/^##\s+(.+)/)
  if(heading){section=heading[1].trim();sections.set(section,[])}else sections.get(section)?.push(line)
 }
 const find=(pattern:RegExp)=>[...sections].filter(([key])=>pattern.test(key)).flatMap(([,lines])=>lines)
 const raw=find(/原料|食材/),calculation=find(/计算|用量/),operation=find(/操作|步骤|做法/)
 if(!raw.length||!operation.length)return null
 const ingredients:Ingredient[]=[]
 // Only whole, unambiguous amounts are numeric. Ranges, alternatives and formulas stay unknown.
 const units='千克|公斤|毫升|克|斤|两|升|个|根|瓣|片|颗|粒|支|只|勺|匙|杯|袋|盒|块|条|kg|ml|g|L'
 const exact=new RegExp(`^(.+?)\\s*(?:=|：|:)?\\s+(\\d+(?:\\.\\d+)?)\\s*(${units})$`,'i')
 const amountLine=new RegExp(`^(.+?)\\s*(?:=|：|:)\\s*(\\d+(?:\\.\\d+)?)\\s*(${units})$`,'i')
 const item=(line:string)=>plain(line.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/,''))
 const tool=/锅|刀|砧板|菜板|烤箱|微波炉|空气炸锅|电饭|打蛋器|料理机|搅拌机|保鲜|容器|漏勺|量杯|厨房|工具|配料$|原料$/
 for(const line of raw.filter(l=>/^\s*[-*+]\s+/.test(l))){
  const value=item(line);if(!value||tool.test(value)||value.length>70)continue
  const match=value.match(exact)||value.match(amountLine)
  const name=match?match[1].replace(/[=：:]$/,'').trim():value
  if(!ingredients.some(i=>i.name===name))ingredients.push({name,amount:match?Number(match[2]):null,unit:match?normalizeUnit(match[3]):'份',type:seasoning.test(name)?'seasoning':'food'})
 }
 for(const line of calculation.filter(l=>/^\s*[-*+]\s+/.test(l))){
  const valueText=item(line)
  const match=valueText.match(exact)||valueText.match(amountLine)
  if(!match){
   const uncertain=valueText.match(/^(.+?)(?:\s*[=：:]\s*|\s+)(?=[\d约适少一二三四五六七八九十半])/)
   const name=uncertain?.[1].trim()
   if(name&&name.length<30&&!tool.test(name)&&!ingredients.some(i=>i.name.startsWith(name)||name.startsWith(i.name)))ingredients.push({name,amount:null,unit:'份',type:seasoning.test(name)?'seasoning':'food'})
   continue
  }
  const name=match[1].replace(/[=：:]$/,'').trim();if(tool.test(name)||name.length>70)continue
  const candidates=ingredients.filter(i=>i.name===name)
  // Repeated quantities may describe different variants; never pick one silently.
  const mentions=calculation.filter(l=>item(l).startsWith(name+' ')||item(l).startsWith(name+'=')).length
  if(mentions>1)continue
  const value:Ingredient={name,amount:Number(match[2]),unit:normalizeUnit(match[3]),type:seasoning.test(name)?'seasoning':'food'}
  if(candidates.length===1)Object.assign(candidates[0],value)
  else if(!ingredients.some(i=>i.name.startsWith(name)||name.startsWith(i.name)))ingredients.push(value)
 }
 if(!ingredients.length)return null
 const steps=operation.map(l=>plain(l.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+|###\s+)/,''))).filter(Boolean)
 return {id:'howtocook-'+createHash('sha256').update(path).digest('hex').slice(0,20),name:plain(title).replace(/的做法$/,''),category:group[0],art:group[1],minutes:null,servings:null,note:'HowToCook · 用量请结合原文确认',ingredients,steps,source:'https://github.com/Anduin2017/HowToCook/blob/master/'+path.split('/').map(encodeURIComponent).join('/'),sourceText:text}
}
function normalizeUnit(unit:string){return ({g:'克',kg:'千克',ml:'毫升',l:'升','公斤':'千克'} as Record<string,string>)[unit.toLowerCase()]||unit}

export function replaceTestCatalog(state:State,recipes:Recipe[]){
 const seedIds=new Set(['tomato','beef','shrimp','soup','greens','tofu'])
 const removed=new Set(state.recipes.filter(r=>r.id.startsWith('demo-extra-')||seedIds.has(r.id)).map(r=>r.id))
 const referenced=new Set(state.orders.flatMap(o=>o.recipeIds))
 state.recipes=state.recipes.filter(r=>!removed.has(r.id)||referenced.has(r.id))
 for(const r of state.recipes)if(removed.has(r.id))r.archived=true
 for(const recipe of recipes){const existing=state.recipes.findIndex(r=>r.id===recipe.id);if(existing<0)state.recipes.push(recipe);else if(!referenced.has(recipe.id))state.recipes[existing]=recipe}
 for(const kitchen of state.kitchens)kitchen.recipeIds=[...new Set([...kitchen.recipeIds.filter(id=>!removed.has(id)),...recipes.map(r=>r.id)])]
 if(state.recipeMarks)for(const records of [state.recipeMarks.signatures,state.recipeMarks.favorites])for(const key of Object.keys(records))records[key]=records[key].filter(id=>!removed.has(id))
 state.testMenuVersion=1
 return {retired:removed.size,archived:state.recipes.filter(r=>removed.has(r.id)).length,imported:recipes.length}
}

export function removeCategories(state:State,categories:string[]){
 const target=new Set(categories), removed=new Set(state.recipes.filter(r=>target.has(r.category)).map(r=>r.id))
 const referenced=new Set(state.orders.flatMap(o=>o.recipeIds))
 state.recipes=state.recipes.filter(r=>!removed.has(r.id)||referenced.has(r.id))
 for(const recipe of state.recipes)if(removed.has(recipe.id))recipe.archived=true
 for(const kitchen of state.kitchens)kitchen.recipeIds=kitchen.recipeIds.filter(id=>!removed.has(id))
 if(state.recipeMarks)for(const records of [state.recipeMarks.signatures,state.recipeMarks.favorites])for(const key of Object.keys(records))records[key]=records[key].filter(id=>!removed.has(id))
 return {removed:[...removed].filter(id=>!referenced.has(id)).length,archived:[...removed].filter(id=>referenced.has(id)).length}
}
