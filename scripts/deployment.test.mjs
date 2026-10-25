import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, copyFileSync, readdirSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { DatabaseSync } from 'node:sqlite'
import { update } from './deployment.mjs'
import { run, layout, control, readJson, writeJson, backupDatabase, childEnv, startApp, activateApp, stopApp } from './deployment-common.mjs'

const source=fileURLToPath(new URL('../',import.meta.url)),cleanup=[]
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn()})
const silent=()=>{}
const fixtureServer=(version,failLive=false)=>`
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {resolve} from 'node:path';
if(${failLive}&&process.env.YICAN_PORT!=='0')throw Error('fixture live startup failed');
const db=new DatabaseSync(resolve(process.env.YICAN_DATA_DIR,'kitchen.sqlite'));
db.exec('UPDATE catalog SET version=${version}');
let ready=false;
const server=createServer((req,res)=>{
 if(req.url==='/api/health'){res.end('{"ok":true}');return}
 if(!ready){res.writeHead(503);res.end('updating');return}
 res.end(req.url==='/api/auth/me'?'{}':'version-${version}');
});
server.listen(Number(process.env.YICAN_PORT),'127.0.0.1',()=>process.send({type:'ready',port:server.address().port}));
let stopping=false;
const stop=()=>{if(stopping)return;stopping=true;server.close(()=>{db.close();process.exit(0)});server.closeAllConnections()};
process.on('message',m=>{if(m==='activate'){ready=true;process.send({type:'active'})}if(m==='shutdown')stop()});
process.on('disconnect',stop);
`
function writeVersion(remote,version,{failBuild=false,failPrepare=false,failLive=false}={}){
  writeFileSync(resolve(remote,'build.mjs'),`
import {mkdirSync,writeFileSync} from 'node:fs';
${failBuild?"throw Error('fixture build failed');":''}
mkdirSync('dist',{recursive:true});writeFileSync('dist/index.html','version-${version}');
mkdirSync('node_modules/tsx',{recursive:true});
writeFileSync('node_modules/tsx/package.json',JSON.stringify({type:'module',exports:'./index.mjs'}));
writeFileSync('node_modules/tsx/index.mjs','');
`)
  writeFileSync(resolve(remote,'server/index.ts'),fixtureServer(version,failLive))
  writeFileSync(resolve(remote,'server/prepare-data.ts'),`
import {DatabaseSync} from 'node:sqlite';import {resolve} from 'node:path';
const db=new DatabaseSync(resolve(process.env.YICAN_DATA_DIR,'kitchen.sqlite'));
db.exec('CREATE TABLE IF NOT EXISTS catalog(version INTEGER); DELETE FROM catalog; INSERT INTO catalog VALUES(${version})');
db.close();${failPrepare?"throw Error('fixture prepare failed');":''}
`)
}
async function fixture(){
  const parent=mkdtempSync(join(tmpdir(),'一餐 update test ')),remote=resolve(parent,'remote'),root=resolve(parent,'installed')
  cleanup.push(()=>{const path=resolve(parent);if(!path.startsWith(resolve(tmpdir())+requireSep()))throw Error('unsafe test cleanup');rmSync(path,{recursive:true,force:true})})
  mkdirSync(resolve(remote,'server'),{recursive:true});mkdirSync(resolve(remote,'scripts'))
  const pkg={name:'yican-update-fixture',version:'1.0.0',type:'module',yicanDeployment:1,scripts:{build:'node build.mjs'}}
  writeFileSync(resolve(remote,'package.json'),JSON.stringify(pkg));writeFileSync(resolve(remote,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':{name:pkg.name,version:pkg.version}}}))
  writeFileSync(resolve(remote,'.gitignore'),'node_modules/\ndist/\ndata/\n.yican/\n')
  for(const file of ['entry.mjs','deployment.mjs','deployment-common.mjs'])copyFileSync(resolve(source,'scripts',file),resolve(remote,'scripts',file))
  writeVersion(remote,1)
  const git=(...args)=>run('git',args,{cwd:remote})
  await git('init','-b','main');await git('config','user.name','Fixture');await git('config','user.email','fixture@example.invalid');await git('add','.');await git('commit','-qm','initial')
  await run('git',['clone',remote,root],{cwd:parent})
  await run(process.execPath,['build.mjs'],{cwd:root})
  mkdirSync(resolve(root,'data'))
  const db=new DatabaseSync(resolve(root,'data/kitchen.sqlite'));db.exec("CREATE TABLE personal(value TEXT); INSERT INTO personal VALUES('用户账号、订单与私家菜谱'); CREATE TABLE catalog(version INTEGER); INSERT INTO catalog VALUES(1)");db.close()
  const paths=layout(root)
  async function start(){
    const reservation=createServer()
    await new Promise(resolvePromise=>reservation.listen(0,'127.0.0.1',resolvePromise))
    const port=reservation.address().port
    await new Promise(resolvePromise=>reservation.close(resolvePromise))
    const child=spawn(process.execPath,['scripts/entry.mjs','start','--host','127.0.0.1','--port',String(port)],{cwd:root,windowsHide:true,stdio:'pipe'})
    let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x)
    cleanup.push(async()=>{
      try{await control(paths,'stop')}catch{}
      if(child.exitCode===null){await new Promise(resolvePromise=>{const t=setTimeout(()=>child.kill('SIGKILL'),5000);child.once('exit',()=>{clearTimeout(t);resolvePromise()})})}
    })
    for(let attempt=0;attempt<200;attempt++){
      if(child.exitCode!==null)throw Error(output)
      const status=await control(paths,'status').catch(()=>null)
      if(status?.running&&await fetch('http://127.0.0.1:'+status.port).then(r=>r.ok).catch(()=>false))return status
      await new Promise(resolvePromise=>setTimeout(resolvePromise,25))
    }
    throw Error('fixture startup timed out: '+output)
  }
  const snapshot=()=>{const db=new DatabaseSync(resolve(root,'data/kitchen.sqlite'),{readOnly:true});try{return {personal:db.prepare('SELECT * FROM personal').all(),catalog:db.prepare('SELECT * FROM catalog').all()}}finally{db.close()}}
  const publish=async(version,options)=>{writeVersion(remote,version,options);await git('add','.');await git('commit','-qm','version '+version);return git('rev-parse','HEAD')}
  return {root,remote,paths,start,snapshot,publish,git}
}
function requireSep(){return process.platform==='win32'?'\\':'/'}

it('stages a real Git update while serving, then keeps the port and user data and saves an original backup',async()=>{
  const f=await fixture(),status=await f.start(),before=f.snapshot(),target=await f.publish(2)
  const result=await update(f.root,{log:silent})
  expect(result).toMatchObject({updated:true,commit:target,running:true})
  expect(await (await fetch('http://127.0.0.1:'+status.port)).text()).toBe('version-2')
  expect(f.snapshot()).toEqual({...before,catalog:[{version:2}]})
  const files=readdirSync(resolve(f.root,'data/backups')).filter(x=>x.startsWith('pre-update-'));expect(files).toHaveLength(1)
  const backup=new DatabaseSync(resolve(f.root,'data/backups',files[0]),{readOnly:true});try{expect(backup.prepare('SELECT version FROM catalog').get().version).toBe(1)}finally{backup.close()}
  expect(readJson(f.paths.current).commit).toBe(target)
  expect(await update(f.root,{log:silent})).toMatchObject({updated:false,commit:target})
  expect(existsSync(f.paths.pending)).toBe(false)
},30_000)

it.each(['build','prepare'])('leaves the old service and database untouched when candidate %s fails',async failure=>{
  const f=await fixture(),status=await f.start(),before=f.snapshot()
  await f.publish(2,{failBuild:failure==='build',failPrepare:failure==='prepare'})
  await expect(update(f.root,{log:silent})).rejects.toThrow('fixture '+failure+' failed')
  expect(await (await fetch('http://127.0.0.1:'+status.port)).text()).toBe('version-1')
  expect(f.snapshot()).toEqual(before);expect(readJson(f.paths.current)).toBeNull()
},30_000)

it('rolls back both code selection and the migrated database if live startup fails after a successful rehearsal',async()=>{
  const f=await fixture(),status=await f.start(),before=f.snapshot()
  await f.publish(2,{failLive:true})
  await expect(update(f.root,{log:silent})).rejects.toThrow('应用提前退出')
  expect(await (await fetch('http://127.0.0.1:'+status.port)).text()).toBe('version-1')
  expect(f.snapshot()).toEqual(before);expect(readJson(f.paths.current)).toBeNull();expect(existsSync(f.paths.pending)).toBe(false)
},30_000)

it('does not overwrite dirty source files or diverged commits',async()=>{
  const f=await fixture();await f.publish(2)
  writeFileSync(resolve(f.root,'local.txt'),'my unpublished work')
  await expect(update(f.root,{log:silent})).rejects.toThrow('本地修改')
  expect(readFileSync(resolve(f.root,'local.txt'),'utf8')).toBe('my unpublished work')
  for(const args of [['config','user.name','Fixture'],['config','user.email','fixture@example.invalid'],['add','local.txt'],['commit','-qm','local changes']])await run('git',args,{cwd:f.root})
  await expect(update(f.root,{log:silent})).rejects.toThrow('分叉')
  expect(readFileSync(resolve(f.root,'local.txt'),'utf8')).toBe('my unpublished work')
},30_000)

it('selects a stopped installation without migrating its real database, then applies content on the next managed start',async()=>{
  const f=await fixture(),before=f.snapshot();await f.publish(2)
  expect(await update(f.root,{log:silent})).toMatchObject({updated:true,running:false})
  expect(f.snapshot()).toEqual(before)
  const status=await f.start()
  expect(await (await fetch('http://127.0.0.1:'+status.port)).text()).toBe('version-2')
  expect(f.snapshot()).toEqual({...before,catalog:[{version:2}]})
},30_000)

it('also restores the old version and latest user data when a stopped update fails on its first managed launch',async()=>{
  const f=await fixture();await f.publish(2,{failLive:true})
  await update(f.root,{log:silent})
  const db=new DatabaseSync(resolve(f.root,'data/kitchen.sqlite'));db.exec("UPDATE personal SET value='停服安装后仍须保留的新数据'");db.close()
  const before=f.snapshot(),status=await f.start()
  expect(await (await fetch('http://127.0.0.1:'+status.port)).text()).toBe('version-1')
  expect(f.snapshot()).toEqual(before)
  expect(readJson(f.paths.current)).toBeNull();expect(existsSync(f.paths.pending)).toBe(false);expect(existsSync(f.paths.deferred)).toBe(false)
},30_000)

it('prepares the real offline catalog and keeps real account writes gated until the managed server is activated',async()=>{
  const parent=mkdtempSync(join(tmpdir(),'yican-real-update-'))
  cleanup.push(()=>{if(!resolve(parent).startsWith(resolve(tmpdir())+requireSep()))throw Error('unsafe cleanup');rmSync(parent,{recursive:true,force:true})})
  await run(process.execPath,['--import','tsx','server/prepare-data.ts'],{cwd:source,env:childEnv(parent)})
  const app=await startApp(source,parent)
  cleanup.push(()=>stopApp(app))
  const base='http://127.0.0.1:'+app.port
  expect((await fetch(base+'/api/health')).status).toBe(200)
  expect((await fetch(base)).status).toBe(503)
  expect((await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1'},body:JSON.stringify({username:'gated',nickname:'等待更新',passwordless:true,role:'chef'})})).status).toBe(503)
  await activateApp(app)
  expect((await fetch(base+'/api/auth/me')).status).toBe(200)
  await stopApp(app)
  const db=new DatabaseSync(resolve(parent,'kitchen.sqlite'),{readOnly:true})
  try{
    expect(db.prepare("SELECT count(*) AS count FROM recipe_versions WHERE id LIKE 'howtocook-%'").get().count).toBe(369)
    expect(db.prepare('SELECT count(*) AS count FROM accounts').get().count).toBe(0)
  }finally{db.close()}
},30_000)

it('recovers an interrupted uncommitted database switch before checking for further updates',async()=>{
  const f=await fixture(),before=f.snapshot(),backup=resolve(f.root,'data/backups/interrupted.sqlite')
  await backupDatabase(resolve(f.root,'data'),backup)
  writeJson(f.paths.pending,{previous:null,backup,dataDir:resolve(f.root,'data'),wasRunning:false})
  writeJson(f.paths.current,{commit:'0'.repeat(40),release:'0'.repeat(40)+'-12345678'})
  const db=new DatabaseSync(resolve(f.root,'data/kitchen.sqlite'));db.exec('UPDATE catalog SET version=99');db.close()
  expect(await update(f.root,{log:silent})).toMatchObject({updated:false})
  expect(f.snapshot()).toEqual(before);expect(readJson(f.paths.current)).toBeNull();expect(existsSync(f.paths.pending)).toBe(false)
},30_000)
