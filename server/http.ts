import { createServer } from 'node:http'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { resolve, extname } from 'node:path'
import { ZodError } from 'zod'
import { gzipSync } from 'node:zlib'
import { Store } from './store'
import { CommandError } from './commands'
import { Accounts, stateForUser } from './auth'

export function createAppServer(store:Store,dist:string,available:()=>boolean=()=>true){
 const accounts=new Accounts(store)
 return createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff')
  const json=(status:number,value:unknown)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
  try{
   const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),pathname=url.pathname
   if(!available()&&pathname!=='/api/health'){res.setHeader('Retry-After','3');json(503,{error:'厨房正在更新，请稍后刷新'});return}
   const sinceValue=url.searchParams.get('since'),since=sinceValue!==null&&/^\d+$/.test(sinceValue)&&Number.isSafeInteger(Number(sinceValue))?Number(sinceValue):undefined
   const user=accounts.current(req.headers.cookie)
   const readBody=async()=>{
    if(req.headers['x-yican-request']!=='1'||!req.headers['content-type']?.startsWith('application/json'))throw new CommandError('请求格式不受支持',403)
    if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw new CommandError('不接受跨站写入',403)
    const chunks:Buffer[]=[];let length=0
    for await(const chunk of req){const buffer=Buffer.from(chunk);length+=buffer.length;if(length>256000)throw new CommandError('提交内容过大',413);chunks.push(buffer)}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
   }
   const session=(value:ReturnType<Accounts['current']>|unknown,token:string)=>{res.setHeader('Set-Cookie',accounts.cookie(token,!!(req.socket as typeof req.socket&{encrypted?:boolean}).encrypted));json(200,{user:value})}
   if(pathname==='/api/auth/me'&&req.method==='GET'){json(200,{user,...accounts.setup()});return}
   if(pathname==='/api/auth/register'&&req.method==='POST'){const result=await accounts.register(await readBody(),req.socket.remoteAddress??'local');session(result.user,result.token);return}
   if(pathname==='/api/auth/login'&&req.method==='POST'){const result=await accounts.login(await readBody(),req.socket.remoteAddress??'local');session(result.user,result.token);return}
   if(pathname==='/api/auth/logout'&&req.method==='POST'){await readBody();accounts.logout(req.headers.cookie);session(null,'');return}
   if(pathname==='/api/auth/security'&&req.method==='POST'){if(!user)throw new CommandError('请先登录',401);const result=await accounts.security(user,await readBody());session(result.user,result.token);return}
   if(pathname.startsWith('/api/invites/')&&req.method==='GET'){json(200,accounts.invite(decodeURIComponent(pathname.slice(13)),user?.id));return}
   if(pathname==='/api/state'&&req.method==='GET'){
    if(!user)throw new CommandError('请先登录',401)
    const snapshot=store.snapshot(),grants=snapshot.state.grants.filter(g=>g.userId===user.id)
    const grantScope=grants.map(g=>snapshot.state.meals.some(m=>m.id===g.mealId&&snapshot.serverNow<+new Date(m.endsAt))?'1':'0').join('')
    const revision=snapshot.revision,etag=`"state-${user.id}-${revision}-${grantScope}"`
    res.setHeader('ETag',etag);res.setHeader('X-Server-Time',Date.now());res.setHeader('Cache-Control','no-store');res.setHeader('Vary','Accept-Encoding')
    if(req.headers['if-none-match']===etag){res.writeHead(304);res.end();return}
    // Grants expire with time, so always return a current projection, even at the same revision.
    const body=JSON.stringify(since===revision&&!grants.length?{revision,serverNow:snapshot.serverNow}:{...snapshot,state:stateForUser(snapshot.state,user.id,snapshot.serverNow)})
    res.setHeader('Content-Type','application/json; charset=utf-8')
    if(body.length>2048&&/\bgzip\b/.test(req.headers['accept-encoding']??'')){res.setHeader('Content-Encoding','gzip');res.end(gzipSync(body))}else res.end(body)
    return
   }
   if(pathname==='/api/health'&&req.method==='GET'){json(200,{ok:true,mode:'lan',serverNow:Date.now(),timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});return}
   if(pathname==='/api/commands'&&req.method==='POST'){
    if(!user)throw new CommandError('请先登录',401)
    const raw=await readBody()
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new CommandError('提交字段无效，请检查内容')
    if(raw.actor&&raw.actor!==user.id)throw new CommandError('不能冒用其他账号身份',403)
    const result=store.execute({...raw,actor:user.id})
    json(200,{...result,state:stateForUser(result.state,user.id,result.serverNow)});return
   }
   if(pathname.startsWith('/api/')){json(404,{error:'接口不存在'});return}
   if(!['GET','HEAD'].includes(req.method||'')){json(405,{error:'不支持此请求'});return}
   const relative=decodeURIComponent(pathname).replace(/^\/+/,'')
   const file=resolve(dist,relative||'index.html')
   if(!file.startsWith(resolve(dist)+'/')&&!file.startsWith(resolve(dist)+'\\')){json(403,{error:'路径无效'});return}
   if(!existsSync(file)||!statSync(file).isFile()){json(404,{error:'文件不存在，请先运行构建'});return}
   const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon'}
   let content:Buffer|string=readFileSync(file)
   if(extname(file)==='.html')content=content.toString().replace('<head>','<head><script>window.__YICAN_LAN__=true;</script>')
   res.writeHead(200,{'Content-Type':mime[extname(file)]||'application/octet-stream','Cache-Control':extname(file)==='.html'?'no-store':'public, max-age=3600'})
   res.end(req.method==='HEAD'?undefined:content)
  }catch(error){if(error instanceof CommandError)json(error.status,{error:error.message});else if(error instanceof ZodError||error instanceof SyntaxError)json(400,{error:'提交字段无效，请检查内容'});else{console.error(error);json(500,{error:'服务保存失败，请保留当前输入后重试'})}}
 })
}
