import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { run, control, layout, readJson } from './deployment-common.mjs'
import { checkOutput, moveDirectory } from './package-portable.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),release=resolve(root,'release')
async function until(fn,message){
  const end=Date.now()+60_000
  while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(r=>setTimeout(r,150))}
  throw Error(message)
}
async function main(){
  const zip=resolve(release,'Yican-Windows-x64.zip'),digest=createHash('sha256').update(readFileSync(zip)).digest('hex')
  assert.equal(readFileSync(resolve(release,'Yican-Windows-x64.sha256'),'utf8').split(' ')[0],digest)
  const work=resolve(root,'build');mkdirSync(work,{recursive:true})
  const scratch=mkdtempSync(resolve(work,'便携验证 ')),destination=resolve(scratch,'中文 空格与&符号')
  mkdirSync(destination)
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop"; Expand-Archive -LiteralPath $env:YICAN_ZIP_SOURCE -DestinationPath $env:YICAN_ZIP_DESTINATION'],{env:{...process.env,YICAN_ZIP_SOURCE:zip,YICAN_ZIP_DESTINATION:destination}})
  let folder=resolve(destination,'Yican'),processChild=null
  const nativeNode=()=>resolve(folder,'runtime/node.exe'),launcher=()=>resolve(folder,'launcher.mjs')
  const env={...process.env,PATH:resolve(process.env.SystemRoot??'C:/Windows','System32'),NODE_OPTIONS:'',NODE_PATH:'',YICAN_DATA_DIR:'',YICAN_HOST:'127.0.0.1',YICAN_NO_PAUSE:'1'}
  delete env.YICAN_DATA_DIR;delete env.YICAN_PORT
  const lines=[]
  let occupied=createServer();await new Promise((r,j)=>{occupied.once('error',j);occupied.listen(0,'127.0.0.1',r)})
  const occupiedPort=occupied.address().port
  async function start(port){
    const cmd=resolve(process.env.SystemRoot??'C:/Windows','System32/cmd.exe')
    processChild=spawn(cmd,['/d','/s','/c',`""${resolve(folder,'点我启动.cmd')}" --no-browser --port ${port}"`],{cwd:scratch,env,windowsHide:true,windowsVerbatimArguments:true,stdio:['ignore','pipe','pipe']})
    for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',b=>lines.push(b.toString()))
    processChild.on('error',error=>lines.push(String(error)))
    const instance=await until(()=>{
      if(processChild.exitCode!==null)throw Error(lines.join(''))
      return readJson(resolve(folder,'.yican/instance.json'))
    },'便携服务未启动：'+lines.join(''))
    const base='http://127.0.0.1:'+instance.port
    await until(async()=>{try{const r=await fetch(base+'/api/health',{signal:AbortSignal.timeout(1500)});return r.ok}catch{return false}},'健康接口未就绪')
    return {instance,base}
  }
  async function stop(){
    if(!processChild||processChild.exitCode!==null)return
    const ended=new Promise(r=>processChild.once('exit',r))
    await control(layout(folder),'stop')
    await Promise.race([ended,new Promise((_,j)=>{const t=setTimeout(()=>j(Error('便携服务停止超时')),15_000);t.unref()})])
    assert(!existsSync(resolve(folder,'.yican/instance.json')))
  }
  try{
    for(const file of ['runtime/node.exe','app/server/index.mjs','app/server/schema.sql','app/dist/index.html','source/scripts/package-portable.mjs','licenses/Node-LICENSE.txt','点我启动到局域网.cmd','点我启动.cmd','点我停止.cmd','点我备份数据.cmd'])assert(existsSync(resolve(folder,file)),file)
    for(const name of ['data','.yican','node_modules','.git'])assert(!existsSync(resolve(folder,name)),name+' leaked into package')
    assert(!existsSync(resolve(folder,'source/data')))
    assert(!existsSync(resolve(folder,'source/AGENTS.md')))
    const started=await start(occupiedPort),{instance,base}=started
    assert.equal(instance.host,'127.0.0.1');assert.notEqual(instance.port,occupiedPort)
    const auth=await (await fetch(base+'/api/auth/me')).json();assert.equal(auth.firstAccount,true)
    const html=await (await fetch(base+'/')).text();assert(html.includes('__YICAN_LAN__'))
    const asset=html.match(/src="\.\/([^"?]+\.js)"/)[1],script=await fetch(base+'/'+asset);assert.equal(script.status,200)
    assert(!/[A-Z]:[\\/][^"'\r\n]*?\.vue/.test(await script.text()),'frontend leaked an absolute component source path')
    const headers={'Content-Type':'application/json','X-Yican-Request':'1'}
    const registration=await fetch(base+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({username:'portable_chef',nickname:'便携主厨',passwordless:true,role:'chef'})})
    assert.equal(registration.status,200);const cookie=registration.headers.get('set-cookie').split(';')[0]
    async function command(command){const r=await fetch(base+'/api/commands',{method:'POST',headers:{...headers,Cookie:cookie},body:JSON.stringify({requestId:randomUUID(),command})});assert.equal(r.status,200,await r.clone().text());return r.json()}
    const created=await command({type:'kitchen.create',name:'便携小厨房',role:'chef'}),kitchenId=created.result.id
    await command({type:'stock.save',kitchenId,value:{name:'番茄',amount:500,unit:'克',type:'food'},expected:null})
    const state=await (await fetch(base+'/api/state',{headers:{Cookie:cookie}})).json()
    assert.equal(state.state.recipes.length,369)
    const photo=state.state.recipes.find(r=>r.art.startsWith('/images/'));const picture=await fetch(base+photo.art);assert.equal(picture.status,200);assert((await picture.arrayBuffer()).byteLength>1000)
    const duplicate=await run(nativeNode(),[launcher(),'start','--local','--no-browser'],{cwd:scratch,env});assert(duplicate.includes('已经在运行'))
    await run(nativeNode(),[launcher(),'backup'],{cwd:scratch,env})
    const backups=readdirSync(resolve(folder,'data/backups')).filter(f=>f.endsWith('.sqlite'));assert(backups.length>0)
    const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(resolve(folder,'data/backups',backups[0]),{readOnly:true})
    try{assert.equal(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n,1);assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok')}finally{db.close()}
    assert.throws(()=>checkOutput(folder),/运行数据/)
    await stop()
    const moved=resolve(destination,'搬家后的 一餐');await moveDirectory(folder,moved);folder=moved
    const restarted=await start(0)
    const login=await fetch(restarted.base+'/api/auth/login',{method:'POST',headers,body:JSON.stringify({identifier:'portable_chef',passwordless:true})});assert.equal(login.status,200)
    const next=await (await fetch(restarted.base+'/api/state',{headers:{Cookie:login.headers.get('set-cookie').split(';')[0]}})).json()
    assert.equal(next.state.kitchens[0].name,'便携小厨房');assert.equal(next.state.stock[0].amount,500);assert.equal(next.state.recipes.length,369)
    await stop()
    writeFileSync(resolve(scratch,'result.json'),JSON.stringify({ok:true,zipSha256:digest,checks:['clean ZIP and corresponding source/licenses','Chinese, spaces and ampersand in relocated path','no system Node/npm/Git on child PATH','loopback-only launch','occupied-port fallback','registration and kitchen/stock writes','369 offline recipes, frontend JS and local photo','duplicate launch detection','online backup integrity','rebuild refuses used output','stop, move folder, restart, login and data persistence']},null,2))
    console.log('PASS 便携 ZIP 独立运行检查。结果：'+resolve(scratch,'result.json'))
  }finally{
    if(processChild&&processChild.exitCode===null)await stop().catch(()=>processChild.kill())
    await new Promise(r=>occupied.close(r))
    writeFileSync(resolve(scratch,'portable.log'),lines.join(''))
  }
}
main().catch(error=>{console.error(error);process.exitCode=1})
