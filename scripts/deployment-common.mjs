import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createConnection } from 'node:net'
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, copyFileSync, rmSync, realpathSync } from 'node:fs'
import { resolve, dirname, sep, delimiter } from 'node:path'
import { once } from 'node:events'

export const readJson=(file,fallback=null)=>existsSync(file)?JSON.parse(readFileSync(file,'utf8')):fallback
export function writeJson(file,value){
  mkdirSync(dirname(file),{recursive:true})
  const temp=file+'.'+randomUUID()+'.tmp'
  writeFileSync(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600})
  renameSync(temp,file)
}
export function layout(root){
  const home=resolve(root,'.yican')
  mkdirSync(home,{recursive:true})
  return {root:resolve(root),home,current:resolve(home,'current.json'),instance:resolve(home,'instance.json'),pending:resolve(home,'pending-update.json'),deferred:resolve(home,'deferred-update.json'),releases:resolve(home,'releases')}
}
export function releaseRoot(paths,current=readJson(paths.current)){
  if(!current)return paths.root
  if(!/^[a-f0-9]{40,64}-[a-f0-9]{8}$/.test(current.release))throw new Error('版本目录记录无效')
  return resolve(paths.releases,current.release)
}
export function removeOwned(paths,target){
  const path=resolve(target)
  if(!path.startsWith(paths.home+sep))throw new Error('拒绝清理项目运行目录以外的路径')
  rmSync(path,{recursive:true,force:true})
}
export function lock(paths,name){
  const file=resolve(paths.home,name+'.lock')
  if(existsSync(file)){
    const old=readJson(file)
    let alive=true
    if(Number.isInteger(old?.pid)&&old.pid>0)try{process.kill(old.pid,0)}catch(e){if(e.code==='ESRCH')alive=false}
    if(alive)throw new Error(name==='update'?'已有更新任务正在执行，请勿重复运行。':'此项目已有启动管理器，请使用原窗口或先停止服务。')
    unlinkSync(file)
  }
  writeFileSync(file,JSON.stringify({pid:process.pid}),{flag:'wx',mode:0o600})
  return ()=>{if(readJson(file)?.pid===process.pid)unlinkSync(file)}
}
export function controlEndpoint(root){
  const key=createHash('sha256').update(process.platform==='win32'?root.toLowerCase():root).digest('hex').slice(0,24)
  return process.platform==='win32'?'\\\\.\\pipe\\yican-'+key:resolve(root,'.yican/control.sock')
}
export async function control(paths,action){
  const instance=readJson(paths.instance)
  if(!instance)return null
  try{process.kill(instance.pid,0)}catch(error){if(error.code==='ESRCH'){unlinkSync(paths.instance);return null}else throw error}
  return new Promise((resolvePromise,reject)=>{
    const socket=createConnection(instance.endpoint),timer=setTimeout(()=>socket.destroy(new Error('启动管理器响应超时')),120_000)
    let body=''
    socket.on('connect',()=>socket.write(JSON.stringify({token:instance.token,action})+'\n'))
    socket.on('data',chunk=>{
      body+=chunk
      if(body.length>65536){socket.destroy(new Error('管理响应过大'));return}
      if(!body.includes('\n'))return
      clearTimeout(timer);socket.end()
      try{const result=JSON.parse(body.split('\n')[0]);if(result.error)reject(new Error(result.error));else resolvePromise(result)}catch(error){reject(error)}
    })
    socket.on('error',error=>{clearTimeout(timer);reject(new Error('无法连接此项目的启动管理器：'+error.message))})
    socket.on('close',()=>{clearTimeout(timer);if(!body.includes('\n'))reject(new Error('启动管理器连接已关闭'))})
  })
}
export function childEnv(dataDir,extra={}){
  return {...process.env,PATH:dirname(process.execPath)+delimiter+(process.env.PATH||''),YICAN_DATA_DIR:dataDir,YICAN_HOST:'127.0.0.1',YICAN_PORT:'0',YICAN_MANAGED:'1',...extra}
}
export function npmCli(){
  const bin=dirname(process.execPath)
  const candidates=[resolve(bin,'node_modules/npm/bin/npm-cli.js'),resolve(bin,'../lib/node_modules/npm/bin/npm-cli.js'),resolve(bin,'../node_modules/npm/bin/npm-cli.js')]
  for(const entry of (process.env.PATH||'').split(delimiter)){
    candidates.push(resolve(entry,'node_modules/npm/bin/npm-cli.js'))
    const executable=resolve(entry,'npm')
    if(existsSync(executable))candidates.push(resolve(dirname(realpathSync(executable)),'npm-cli.js'))
  }
  const result=candidates.find(path=>existsSync(path))
  if(!result)throw new Error('未找到 npm，请使用完整的 Node.js 24+ 发行版。')
  return result
}
export async function run(command,args,{cwd,env=process.env,log=()=>{},onSpawn=()=>{}}={}){
  return new Promise((resolvePromise,reject)=>{
    const child=spawn(command,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe']})
    let setupError
    try{onSpawn(child)}catch(error){setupError=error;child.kill('SIGKILL')}
    let output=''
    for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const value=chunk.toString();output=(output+value).slice(-256000);log(value)})
    child.on('error',reject)
    child.on('close',code=>setupError?reject(setupError):code===0?resolvePromise(output.trim()):reject(new Error(command+' 执行失败（'+code+'）：'+output.slice(-2000))))
  })
}
function message(child,type,timeout=60_000){
  return new Promise((resolvePromise,reject)=>{
    const timer=setTimeout(()=>finish(new Error('应用启动或响应超时：'+type)),timeout)
    const onMessage=value=>{if(value?.type===type)finish(null,value)}
    const onExit=code=>finish(new Error('应用提前退出：'+code))
    const onError=error=>finish(error)
    function finish(error,value){clearTimeout(timer);child.off('message',onMessage);child.off('exit',onExit);child.off('error',onError);error?reject(error):resolvePromise(value)}
    child.on('message',onMessage);child.on('exit',onExit);child.on('error',onError)
  })
}
export async function stopApp(app){
  if(!app||app.child.exitCode!==null||app.child.signalCode!==null)return
  const ended=once(app.child,'exit')
  if(app.child.connected)app.child.send('shutdown',()=>{})
  const timer=setTimeout(()=>app.child.kill('SIGKILL'),10_000)
  try{await ended}finally{clearTimeout(timer)}
}
export async function startApp(release,dataDir,{host='127.0.0.1',port=0,log=()=>{}}={}){
  const child=spawn(process.execPath,['--import','tsx','server/index.ts'],{cwd:release,env:childEnv(dataDir,{YICAN_HOST:host,YICAN_PORT:String(port)}),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']})
  for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>log(chunk.toString()))
  const app={child,port:0}
  try{app.port=(await message(child,'ready')).port;return app}catch(error){await stopApp(app);throw error}
}
export async function activateApp(app){const ready=message(app.child,'active');app.child.send('activate',()=>{});await ready}
export async function backupDatabase(dataDir,destination){
  const path=resolve(dataDir,'kitchen.sqlite')
  if(!existsSync(path))return null
  mkdirSync(dirname(destination),{recursive:true})
  const {DatabaseSync,backup}=await import('node:sqlite'),db=new DatabaseSync(path,{readOnly:true})
  try{await backup(db,destination);return destination}finally{db.close()}
}
export function restoreDatabase(paths,pending){
  // Only called with the managed application stopped; preserve the failed state for diagnosis.
  const dataDir=resolve(pending.dataDir),saved=resolve(paths.home,'recovery',randomUUID())
  mkdirSync(saved,{recursive:true})
  for(const name of ['kitchen.sqlite','kitchen.sqlite-wal','kitchen.sqlite-shm']){
    const file=resolve(dataDir,name)
    if(existsSync(file)){copyFileSync(file,resolve(saved,name));unlinkSync(file)}
  }
  if(pending.backup)copyFileSync(pending.backup,resolve(dataDir,'kitchen.sqlite'))
  if(pending.previous)writeJson(paths.current,pending.previous)
  else if(existsSync(paths.current))unlinkSync(paths.current)
  const deferred=readJson(paths.deferred)
  if(deferred&&deferred.candidate?.release===pending.candidate?.release)unlinkSync(paths.deferred)
  unlinkSync(paths.pending)
}
