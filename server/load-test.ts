import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AddressInfo } from 'node:net'
import { Agent, request } from 'node:http'
import { Store } from './store'
import { createSeed } from '../src/seed'
import { createAppServer } from './http'

if(process.argv.includes('--worker')){
 const store=new Store(process.argv[process.argv.indexOf('--db')+1])
 const seed=createSeed(),recipe=seed.recipes[0],future='2099-01-01'
 store.update(s=>{
  s.recipes=Array.from({length:600},(_,i)=>({...recipe,id:'recipe-'+i,name:'测试菜 '+i,sourceText:('测试菜谱原文 '+i+'\n').repeat(160)}))
  s.kitchens=[];s.members=[];s.meals=[];s.orders=[];s.stock=[];s.reviews=[];s.grants=[];s.invites=[];s.checked={};s.recipeMarks={signatures:{},favorites:{}}
  for(let i=0;i<1000;i++){
   const id='kitchen-'+i,mealId='meal-'+i
   s.kitchens.push({id,name:'压力测试厨房 '+i,subtitle:'隔离测试',chefId:'chen',ownerId:'chen',chefLabel:'主厨',dinerLabel:'食客',recipeIds:s.recipes.slice(0,12).map(r=>r.id)})
   s.members.push({kitchenId:id,userId:'chen',role:'chef'},{kitchenId:id,userId:'lin',role:'diner'},{kitchenId:id,userId:'simulated-user-'+i,role:'diner'})
   s.meals.push({id:mealId,kitchenId:id,date:future,name:'午餐',startsAt:future+'T12:00:00',endsAt:future+'T14:00:00',deadline:future+'T11:00:00',status:'open',portions:{}})
   s.orders.push({id:'order-'+i,mealId,userId:'lin',recipeIds:['recipe-0'],note:'测试',createdAt:future+'T10:00:00'})
   s.stock.push({id:'stock-'+i,kitchenId:id,name:'番茄',amount:1000,unit:'克',type:'food'})
  }
 })
 const server=createAppServer(store,resolve('dist'))
 server.listen({port:0,host:'127.0.0.1',backlog:4096},()=>process.send?.({port:(server.address() as AddressInfo).port,revision:store.revision(),bytes:Buffer.byteLength(store.fullJson())}))
 process.on('message',message=>{if(message==='stop')server.close(()=>{store.close();process.exit(0)})})
}else{
 const dir=mkdtempSync(join(tmpdir(),'yican-load-')),db=join(dir,'load.sqlite')
 const worker=spawn(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--worker','--db',db],{stdio:['ignore','pipe','pipe','ipc'],windowsHide:true})
 worker.stderr?.on('data',chunk=>process.stderr.write(chunk))
 try{
  const info=await new Promise<{port:number;revision:number;bytes:number}>((resolve,reject)=>{worker.once('message',message=>resolve(message as any));worker.once('error',reject);worker.once('exit',code=>reject(new Error('load worker exited '+code)))})
  const base=`http://127.0.0.1:${info.port}`,reports=[]
  // Use the real first-run account flow; benchmarks must not bypass authentication.
  const registration=await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1'},body:JSON.stringify({username:'load_chef',nickname:'压力测试主厨',passwordless:true,role:'chef',adoptLegacy:true})})
  if(!registration.ok)throw new Error('Load fixture registration failed')
  const cookie=registration.headers.get('set-cookie')!.split(';')[0],headers={Cookie:cookie}
  info.revision=(await (await fetch(base+'/api/state',{headers})).json()).revision
  // Closed-loop saturation with 95% authenticated polling / 5% atomic meal writes.
  for(const {clients,duration,interval} of [{clients:100,duration:10000,interval:0},{clients:1000,duration:30000,interval:0},{clients:1000,duration:30000,interval:2000}]){
   const agent=new Agent({keepAlive:true,maxSockets:clients,maxFreeSockets:clients})
   const initial=await (await fetch(base+'/api/state?since=0',{headers})).json(),latencies:number[]=[]
   const errorKinds:Record<string,number>={};let requests=0,writes=0,bytes=0,errors=0;const start=performance.now(),stop=start+duration
   await Promise.all(Array.from({length:clients},async(_,client)=>{
    let revision=initial.revision,writeCount=0
    if(interval)await new Promise(resolve=>setTimeout(resolve,client/clients*interval))
    while(performance.now()<stop){
     const id=requests++,write=id%20===0,began=performance.now()
     try{
      const response=await new Promise<{status:number;text:string}>((resolve,reject)=>{
       const req=request(base+(write?'/api/commands':'/api/state')+'?since='+revision,{agent,method:write?'POST':'GET',headers:{...headers,...(write?{'Content-Type':'application/json','X-Yican-Request':'1'}:{})}},res=>{const chunks:Buffer[]=[];res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode!,text:Buffer.concat(chunks).toString()}))})
       req.setTimeout(30000,()=>req.destroy(new Error('request timeout')));req.on('error',reject)
       req.end(write?JSON.stringify({requestId:randomUUID(),actor:'chen',command:{type:'meal.portion',mealId:'meal-'+client,recipeId:'recipe-0',delta:writeCount++%2?-1:1}}):undefined)
      })
      const text=response.text;bytes+=Buffer.byteLength(text)
      if(response.status!==200)throw new Error('HTTP '+response.status+' '+text.slice(0,160))
      const value=JSON.parse(text);revision=value.revision;if(write)writes++
     }catch(error){errors++;const key=String((error as any).code??(error as Error).message);errorKinds[key]=(errorKinds[key]??0)+1;await new Promise(resolve=>setTimeout(resolve,100));}
     latencies.push(performance.now()-began)
     if(interval)await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(stop-performance.now(),interval-(performance.now()-began)))))
    }
   }))
   latencies.sort((a,b)=>a-b);const elapsed=(performance.now()-start)/1000
   agent.destroy()
   const report={clients,intervalMs:interval,seconds:+elapsed.toFixed(2),requests,successful:requests-errors,writes,errors,errorKinds,rps:+((requests-errors)/elapsed).toFixed(1),p50Ms:+latencies[Math.floor(latencies.length*.5)].toFixed(1),p95Ms:+latencies[Math.floor(latencies.length*.95)].toFixed(1),p99Ms:+latencies[Math.floor(latencies.length*.99)].toFixed(1),averageResponseBytes:Math.round(bytes/requests)}
   reports.push(report);console.log(JSON.stringify(report))
  }
  const final=await (await fetch(base+'/api/state',{headers})).json(),expectedWrites=reports.reduce((n,r)=>n+r.writes,0)
  if(final.revision!==info.revision+expectedWrites)throw new Error('Committed revision count differs from acknowledged writes')
  const result={at:new Date().toISOString(),node:process.version,platform:process.platform,cpuCount:(await import('node:os')).cpus().length,database:db,fullStateBytes:info.bytes,fixtures:{kitchens:1000,users:1003,recipes:600,meals:1000,orders:1000},workload:'10s / 30s / 30s phases; 95% authenticated polling / 5% atomic meal writes; changed reads return the full authorized projection; phase 3 staggers 1000 clients at 2s intervals; HTTP keep-alive, loopback, WAL synchronous FULL, separate server/load processes; clients share one registered chef session, 1000 synthetic member records',acknowledgedWrites:expectedWrites,revisionCheck:true,reports}
  mkdirSync('data/load-tests',{recursive:true});writeFileSync('data/load-tests/latest.json',JSON.stringify(result,null,2));console.log('Report: data/load-tests/latest.json')
  if(reports.some(r=>r.errors))process.exitCode=1
 }finally{worker.send('stop');setTimeout(()=>worker.kill(),5000).unref()}
}
