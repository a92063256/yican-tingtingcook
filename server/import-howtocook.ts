import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, relative, join } from 'node:path'
import { Store } from './store'
import { parseRecipe, replaceTestCatalog } from './howtocook'
const sourceArg=process.argv.slice(2).find(arg=>arg!=='--apply')
if(!sourceArg)throw new Error('请指定 HowToCook 源码目录，例如：npm run import:howtocook -- ./HowToCook（预览）；确认并备份后再加 --apply。')
const source=resolve(sourceArg)
const apply=process.argv.includes('--apply')
const walk=(dir:string):string[]=>readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(join(dir,entry.name)):[join(dir,entry.name)])
const files=walk(join(source,'dishes')).filter(p=>p.endsWith('.md'))
const skipped:string[]=[],recipes=files.flatMap(file=>{const path=relative(source,file).replaceAll('\\','/');const r=parseRecipe(path,readFileSync(file,'utf8'));if(!r){skipped.push(path);return []}return [r]})
if(recipes.length<100)throw new Error('菜谱数量异常，取消导入')
const report={source,scanned:files.length,imported:recipes.length,skipped,unknownIngredients:recipes.reduce((sum,r)=>sum+r.ingredients.filter(i=>i.amount===null).length,0),mode:apply?'applied':'preview'}
if(apply){
 const store=new Store(resolve(process.env.YICAN_DATA_DIR||'data','kitchen.sqlite'))
 try{console.log(store.update(state=>replaceTestCatalog(state,recipes)))}finally{store.close()}
 mkdirSync('data/imports',{recursive:true});writeFileSync('data/imports/howtocook-report.json',JSON.stringify(report,null,2));writeFileSync('data/imports/HowToCook-LICENSE',readFileSync(join(source,'LICENSE')))
}
console.log(JSON.stringify(report,null,2))
