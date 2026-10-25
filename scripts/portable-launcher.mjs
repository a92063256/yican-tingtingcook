import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { appendFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes, randomUUID } from 'node:crypto'
import { layout, lock, control, controlEndpoint, readJson, writeJson, backupDatabase } from './app/scripts/deployment-common.mjs'

const root=dirname(fileURLToPath(import.meta.url)),paths=layout(root)
function options(args){
  const value=name=>{const i=args.indexOf(name);if(i<0)return undefined;if(!args[i+1]||args[i+1].startsWith('--'))throw Error(name+' 缺少参数');return args[i+1]}
  const host=args.includes('--local')?'127.0.0.1':value('--host')??process.env.YICAN_HOST??'0.0.0.0'
  const port=Number(value('--port')??process.env.YICAN_PORT??3000)
  if(!['127.0.0.1','0.0.0.0'].includes(host)||!Number.isInteger(port)||port<0||port>65535)throw Error('监听地址或端口无效')
  return {host,port,dataDir:resolve(process.env.YICAN_DATA_DIR??resolve(root,'data')),browser:!args.includes('--no-browser')}
}
function openBrowser(port){
  const cmd=resolve(process.env.SystemRoot??'C:/Windows','System32/cmd.exe')
  const child=spawn(cmd,['/d','/c','start','""','http://127.0.0.1:'+port+'/'],{windowsHide:true,stdio:'ignore'})
  child.on('error',error=>console.error('请手动打开浏览器：'+error.message));child.unref()
}
async function start(config){
  const existing=await control(paths,'status')
  if(existing){console.log('一餐已经在运行：http://127.0.0.1:'+existing.port);if(config.browser)openBrowser(existing.port);return}
  const unlock=lock(paths,'service'),endpoint=controlEndpoint(root),token=randomBytes(32).toString('hex')
  let app,closing=false,finish
  const ended=new Promise(r=>finish=r)
  const logs=resolve(paths.home,'logs');mkdirSync(logs,{recursive:true})
  const logFile=resolve(logs,'start-'+new Date().toISOString().replace(/[:.]/g,'-')+'.log')
  const log=text=>{appendFileSync(logFile,text);process.stdout.write(text)}
  async function stopChild(){
    const child=app;app=null
    if(!child||child.exitCode!==null||child.signalCode!==null)return
    await new Promise(r=>{
      const timer=setTimeout(()=>child.kill(),10_000)
      child.once('exit',()=>{clearTimeout(timer);r()})
      if(child.connected)child.send('shutdown',()=>{});else child.kill()
    })
  }
  function launch(port){
    return new Promise((resolvePromise,reject)=>{
      const child=spawn(process.execPath,[resolve(root,'app/server/index.mjs')],{
        cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
        env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',YICAN_DATA_DIR:config.dataDir,YICAN_HOST:config.host,YICAN_PORT:String(port),YICAN_MANAGED:'1'},
      })
      app=child;let output='',ready=false
      const timer=setTimeout(()=>{child.kill();reject(Error('启动超时，请查看 '+logFile))},60_000)
      for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{const text=chunk.toString();output=(output+text).slice(-4000);log(text)})
      child.on('error',error=>{clearTimeout(timer);reject(error)})
      child.on('message',message=>{
        if(message?.type==='ready'){
          config.port=message.port;child.send('activate',()=>{})
        }else if(message?.type==='active'){ready=true;clearTimeout(timer);resolvePromise()}
      })
      child.on('exit',code=>{
        clearTimeout(timer)
        if(!ready)reject(Error(output||'服务提前退出：'+code))
        else if(!closing){process.exitCode=code||1;log('服务已停止，请检查日志后重新启动。\n');finish()}
      })
    })
  }
  const server=createServer(socket=>{
    let body='',handled=false
    socket.setTimeout(10_000,()=>socket.destroy());socket.on('error',()=>{})
    socket.on('data',chunk=>{
      if(handled)return
      body+=chunk;if(body.length>4096){socket.destroy();return}if(!body.includes('\n'))return
      handled=true
      try{
        const request=JSON.parse(body.split('\n')[0]);if(request.token!==token)throw Error('管理凭据无效')
        if(request.action==='status')socket.end(JSON.stringify({running:!!app,host:config.host,port:config.port,dataDir:config.dataDir})+'\n')
        else if(request.action==='stop'){socket.end('{"ok":true}\n');closing=true;finish()}
        else throw Error('便携版仅支持 status / stop')
      }catch(error){socket.end(JSON.stringify({error:error.message})+'\n')}
    })
  })
  const shutdown=()=>{closing=true;finish()}
  process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown)
  try{
    await new Promise((r,j)=>{server.once('error',j);server.listen(endpoint,r)})
    try{await launch(config.port)}catch(error){
      if(!config.port||!error.message.includes('EADDRINUSE'))throw error
      log('端口 '+config.port+' 已被占用，正在使用其他空闲端口。\n');await launch(0)
    }
    writeJson(paths.instance,{pid:process.pid,endpoint,token,...config})
    log('打开浏览器：http://127.0.0.1:'+config.port+'/\n数据保存在：'+config.dataDir+'\n保留此窗口；按 Ctrl+C 或运行「点我停止.cmd」停止。\n')
    if(config.browser)openBrowser(config.port)
    await ended
  }finally{
    closing=true;await stopChild()
    if(server.listening)await new Promise(r=>server.close(r))
    if(readJson(paths.instance)?.pid===process.pid)unlinkSync(paths.instance)
    process.off('SIGINT',shutdown);process.off('SIGTERM',shutdown);unlock()
  }
}
async function main(){
  const [action='start',...args]=process.argv.slice(2),config=options(args)
  if(action==='start')return start(config)
  if(action==='backup'){
    const instance=await control(paths,'status'),dataDir=instance?.dataDir??config.dataDir
    const target=resolve(dataDir,'backups','kitchen-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8)+'.sqlite')
    if(!existsSync(resolve(dataDir,'kitchen.sqlite')))throw Error('数据库尚未创建，请先启动一次。')
    await backupDatabase(dataDir,target);console.log('备份已保存：'+target);return
  }
  if(!['status','stop'].includes(action))throw Error('用法：launcher.mjs start|stop|status|backup [--local] [--no-browser] [--port 3000]')
  console.log(await control(paths,action)??'一餐当前没有运行。')
}
main().catch(error=>{console.error('一餐启动器：'+error.message);process.exitCode=1})
