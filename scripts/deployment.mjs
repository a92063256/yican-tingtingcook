import { createServer } from 'node:net'
import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, appendFileSync, unlinkSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { layout, readJson, writeJson, releaseRoot, lock, controlEndpoint, control, startApp, stopApp, activateApp, run, childEnv, npmCli, backupDatabase, restoreDatabase, removeOwned } from './deployment-common.mjs'

function pruneReleases(paths,keep,log){
  for(const entry of readdirSync(paths.releases,{withFileTypes:true})){
    if(entry.isDirectory()&&/^[a-f0-9]{40,64}-[a-f0-9]{8}$/.test(entry.name)&&!keep.includes(entry.name)){
      try{removeOwned(paths,resolve(paths.releases,entry.name))}catch(error){log('旧程序目录暂未清理：'+error.message+'\n')}
    }
  }
}
async function recover(paths,log){
  const pending=readJson(paths.pending)
  if(!pending)return
  if(pending.workerPid){
    let alive=true
    try{process.kill(pending.workerPid,0)}catch(error){if(error.code==='ESRCH')alive=false;else throw error}
    if(alive)throw new Error('上次数据库准备进程仍在运行，请稍后再次更新。')
  }
  log('发现上次未完成的切换，正在恢复更新前版本与数据。\n')
  const service=await control(paths,'pause')
  if(!service&&pending.appPid){
    let alive=true
    try{process.kill(pending.appPid,0)}catch(error){if(error.code==='ESRCH')alive=false;else throw error}
    if(alive)throw new Error('上次更新的应用仍在退出，请稍后重新运行更新；不会强制结束未知进程。')
  }
  restoreDatabase(paths,pending)
  if(service&&pending.wasRunning)await control(paths,'resume')
}

export async function supervise(root,{host='0.0.0.0',port=3000,dataDir=resolve(root,'data'),log=value=>process.stdout.write(value)}={}){
  const paths=layout(root)
  let initialized=lock(paths,'update'),unlock
  try{unlock=lock(paths,'service')}catch(error){initialized();throw error}
  let app=null,paused=false,closing=false,busy=false,finish
  const ended=new Promise(resolvePromise=>finish=resolvePromise)
  const token=randomBytes(32).toString('hex'),endpoint=controlEndpoint(root)
  const start=async gated=>{
    app=await startApp(releaseRoot(paths),dataDir,{host,port,log})
    if(port===0)port=app.port
    const thisApp=app
    app.child.on('exit',()=>{if(app===thisApp){app=null;if(!paused&&!closing)log('应用已停止；重新启动或运行更新可恢复。\n')}})
    const pending=readJson(paths.pending)
    if(pending){pending.appPid=app.child.pid;writeJson(paths.pending,pending)}
    if(!gated)await activateApp(app)
  }
  async function stop(){const previous=app;app=null;await stopApp(previous)}
  const server=createServer(socket=>{
    let body='',handled=false
    socket.setTimeout(120_000,()=>socket.destroy())
    socket.on('error',()=>{})
    socket.on('data',async chunk=>{
      if(handled)return
      body+=chunk
      if(body.length>65536){socket.destroy();return}
      if(!body.includes('\n'))return
      handled=true
      try{
        const request=JSON.parse(body.split('\n')[0])
        if(request.token!==token)throw new Error('管理凭据无效')
        if(request.action==='status'){socket.end(JSON.stringify({running:!!app,paused,host,port:app?.port??port,dataDir,current:readJson(paths.current)})+'\n');return}
        if(busy)throw new Error('另一项启动管理操作正在进行')
        busy=true
        try{
          if(request.action==='pause'){paused=true;await stop()}
          else if(request.action==='prepare'){if(app)throw new Error('应用尚未停止');paused=true;await start(true)}
          else if(request.action==='commit'){
            if(!app)throw new Error('新版尚未就绪')
            // Persist the decision before opening business requests. Recovery must never discard post-update writes.
            if(existsSync(paths.pending))unlinkSync(paths.pending)
            await activateApp(app);paused=false
          }
          else if(request.action==='resume'){if(existsSync(paths.pending))throw new Error('请先运行一键更新恢复未完成的切换');if(!app)await start(false);paused=false}
          else if(request.action==='stop'){closing=true;await stop();setImmediate(()=>finish())}
          else throw new Error('未知的管理操作')
          socket.end(JSON.stringify({ok:true,dataDir,host,port:app?.port??port})+'\n')
        }finally{busy=false}
      }catch(error){socket.end(JSON.stringify({error:error.message})+'\n')}
    })
  })
  const shutdown=()=>{closing=true;finish()}
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
  try{
    if(existsSync(paths.pending))throw new Error('上次更新未完成，请先运行 update-lan.cmd 自动恢复。')
    if(process.platform!=='win32'&&existsSync(endpoint))unlinkSync(endpoint)
    await new Promise((resolvePromise,reject)=>{server.once('error',reject);server.listen(endpoint,resolvePromise)})
    writeJson(paths.instance,{pid:process.pid,token,endpoint,host,port,dataDir})
    const deferred=readJson(paths.deferred)
    if(deferred){
      if(resolve(deferred.dataDir)!==resolve(dataDir))throw new Error('待启动更新的数据目录与本次启动不同，请沿用更新时的 YICAN_DATA_DIR。')
      const backup=await backupDatabase(dataDir,resolve(dataDir,'backups','pre-first-start-'+randomUUID()+'.sqlite'))
      writeJson(paths.pending,{previous:deferred.previous,candidate:deferred.candidate,backup,dataDir,wasRunning:false})
      try{
        writeJson(paths.current,deferred.candidate)
        await start(true)
        unlinkSync(paths.deferred)
        unlinkSync(paths.pending)
        await activateApp(app)
      }catch(error){
        if(!existsSync(paths.pending))throw error
        await stop()
        restoreDatabase(paths,readJson(paths.pending))
        if(existsSync(paths.deferred))unlinkSync(paths.deferred)
        log('新版首次启动失败，已恢复旧版与启动前数据：'+error.message+'\n')
        await start(false)
      }
    }else await start(false)
    initialized();initialized=null
    await ended
  }finally{
    closing=true
    await stop()
    if(server.listening)await new Promise(resolvePromise=>server.close(resolvePromise))
    if(readJson(paths.instance)?.pid===process.pid)unlinkSync(paths.instance)
    process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown)
    initialized?.()
    unlock()
  }
}

export async function update(root,{log=value=>process.stdout.write(value)}={}){
  const paths=layout(root),unlock=lock(paths,'update')
  const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)
  const logs=resolve(paths.home,'logs');mkdirSync(logs,{recursive:true})
  const logFile=resolve(logs,'update-'+stamp+'.log')
  const output=value=>{appendFileSync(logFile,value);log(value)}
  let stage=null,work=null,switched=false
  try{
    await recover(paths,output)
    const git=(...args)=>run('git',args,{cwd:root})
    if(resolve(await git('rev-parse','--show-toplevel')).toLowerCase()!==resolve(root).toLowerCase())throw new Error('请从完整的 Git 项目目录运行更新；源码 ZIP 暂不支持自动拉取版本。')
    if(await git('status','--porcelain','--untracked-files=normal'))throw new Error('项目中有本地修改或未跟踪文件。请先保存／提交这些修改，更新器不会覆盖或自动暂存它们。')
    const branch=await git('symbolic-ref','--short','HEAD')
    const remote=await git('config','--get','branch.'+branch+'.remote'),ref=await git('config','--get','branch.'+branch+'.merge')
    if(remote==='.'||!ref.startsWith('refs/heads/'))throw new Error('请为当前分支配置正常的远程跟踪分支。')
    const previous=readJson(paths.current),base=previous?.commit??await git('rev-parse','HEAD')
    const tracking='refs/remotes/'+remote+'/'+ref.slice('refs/heads/'.length)
    output('正在检查 '+remote+'/'+ref.slice('refs/heads/'.length)+' 的更新…\n')
    await git('fetch','--no-tags','--',remote,ref+':'+tracking)
    const target=await git('rev-parse',tracking)
    if(base===target){output('已是最新安装版本：'+base.slice(0,8)+'。\n');return {updated:false,commit:base}}
    const ancestor=await git('merge-base',base,target)
    if(ancestor===target){output('当前版本已包含远程版本，本地提交尚未发布，无需更新。\n');return {updated:false,commit:base}}
    if(ancestor!==base)throw new Error('本地版本与远程分支已分叉，已取消更新；不会强制重置或丢弃本地提交。')
    stage={commit:target,release:target+'-'+randomUUID().slice(0,8),installedAt:new Date().toISOString()}
    const candidate=releaseRoot(paths,stage)
    work=resolve(paths.home,'staging',stamp);mkdirSync(work,{recursive:true});mkdirSync(candidate,{recursive:true})
    const archive=resolve(work,'source.tar')
    await git('archive','--format=tar','--output='+archive,target)
    await run('tar',['-xf',archive,'-C',candidate])
    const pkg=readJson(resolve(candidate,'package.json'))
    if(pkg?.yicanDeployment!==1||!existsSync(resolve(candidate,'server/prepare-data.ts'))||!existsSync(resolve(candidate,'scripts/deployment.mjs')))throw new Error('目标版本尚不支持此更新流程，请使用支持一键更新的发布版本。')
    output('准备新版 '+target.slice(0,8)+'，旧服务继续运行。\n')
    const npm=npmCli()
    const rehearsal=resolve(work,'rehearsal'),env=childEnv(rehearsal,{NODE_ENV:'development'})
    await run(process.execPath,[npm,'ci','--include=dev','--no-audit','--no-fund'],{cwd:candidate,env,log:output})
    await run(process.execPath,[npm,'run','build'],{cwd:candidate,env,log:output})
    const service=await control(paths,'status'),dataDir=resolve(service?.dataDir??process.env.YICAN_DATA_DIR??resolve(root,'data'))
    mkdirSync(rehearsal,{recursive:true})
    await backupDatabase(dataDir,resolve(rehearsal,'kitchen.sqlite'))
    await run(process.execPath,['--import','tsx','server/prepare-data.ts'],{cwd:candidate,env,log:output})
    const probe=await startApp(candidate,rehearsal,{log:output})
    try{
      await activateApp(probe)
      for(const path of ['/api/health','/api/auth/me','/']){
        const response=await fetch('http://127.0.0.1:'+probe.port+path,{signal:AbortSignal.timeout(10_000)})
        if(!response.ok)throw new Error('新版本机预检失败：'+path+' '+response.status)
        await response.arrayBuffer()
      }
    }finally{await stopApp(probe)}
    // No running manager means no production database migration. Select a release for the next managed launch.
    if(!service){
      await backupDatabase(dataDir,resolve(dataDir,'backups','pre-update-'+stamp+'.sqlite'))
      const deferred=readJson(paths.deferred),fallback=deferred?deferred.previous:previous
      writeJson(paths.deferred,{previous:fallback,candidate:stage,dataDir})
      writeJson(paths.current,stage);switched=true
      pruneReleases(paths,[stage.release,fallback?.release],output)
      output('新版已安装；下次通过 start-lan.cmd 启动时生效。未结束其他启动方式的进程。\n')
      return {updated:true,commit:target,running:false}
    }
    output('预检通过，短暂停服并备份数据库。\n')
    await control(paths,'pause')
    try{
      const backup=await backupDatabase(dataDir,resolve(dataDir,'backups','pre-update-'+stamp+'.sqlite'))
      writeJson(paths.pending,{previous,candidate:stage,backup,dataDir,wasRunning:service.running})
      await run(process.execPath,['--import','tsx','server/prepare-data.ts'],{cwd:candidate,env:childEnv(dataDir),log:output,onSpawn:child=>{
        const pending=readJson(paths.pending);pending.workerPid=child.pid;writeJson(paths.pending,pending)
      }})
      writeJson(paths.current,stage)
      await control(paths,'prepare')
      await control(paths,'commit')
      switched=true
      pruneReleases(paths,[stage.release,previous?.release],output)
    }catch(error){
      if(existsSync(paths.pending)){
        await control(paths,'pause')
        const pending=readJson(paths.pending);restoreDatabase(paths,pending)
        if(service.running)await control(paths,'resume')
        output('切换失败，已恢复旧版本与更新前数据库。\n')
      }else if(readJson(paths.current)?.release===stage.release){
        switched=true
        throw new Error('新版已提交，请检查启动状态后重启；为保留更新后的写入，未回退数据库。原因：'+error.message)
      }else if(service.running)await control(paths,'resume')
      throw error
    }
    output('更新完成：'+target.slice(0,8)+'，已恢复服务，原访问地址不变。\n')
    return {updated:true,commit:target,running:true}
  }catch(error){output('更新未完成：'+error.message+'\n日志：'+logFile+'\n');throw error}
  finally{
    // Keep a pending release available for crash recovery. Never delete the selected version.
    if(stage&&!switched&&!existsSync(paths.pending)&&readJson(paths.current)?.release!==stage.release)removeOwned(paths,releaseRoot(paths,stage))
    if(work)removeOwned(paths,work)
    unlock()
  }
}

export async function main(root,args){
  const action=args[0]??'status'
  if(action==='update')return update(root)
  if(action==='start'){
    const value=name=>{const index=args.indexOf(name);return index<0?undefined:args[index+1]}
    const host=value('--host')??'0.0.0.0',port=Number(value('--port')??process.env.YICAN_PORT??3000)
    if(!['127.0.0.1','0.0.0.0'].includes(host)||!Number.isInteger(port)||port<0||port>65535)throw new Error('启动地址或端口无效')
    return supervise(root,{host,port,dataDir:resolve(process.env.YICAN_DATA_DIR??resolve(root,'data'))})
  }
  if(!['status','stop'].includes(action))throw new Error('用法：node scripts/entry.mjs start|update|status|stop')
  const result=await control(layout(root),action)
  console.log(result?JSON.stringify(result,null,2):'此项目没有正在运行的启动管理器。')
}
