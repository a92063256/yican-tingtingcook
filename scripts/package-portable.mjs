import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cpSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { run, npmCli } from './deployment-common.mjs'

const root=fileURLToPath(new URL('../',import.meta.url)),release=resolve(root,'release'),buildRoot=resolve(root,'build')
const hash=file=>createHash('sha256').update(readFileSync(file)).digest('hex')
const readJson=file=>JSON.parse(readFileSync(file,'utf8'))
const log=text=>process.stdout.write(text)
const appName='Yican',archiveName='Yican-Windows-x64.zip'
const excluded=/^(?:data|\.yican|node_modules|\.git|release|build|AGENTS\.md)$|\.(?:sqlite(?:-wal|-shm)?|db(?:-wal|-shm)?|pem|key|pfx|p12|bak|log)$|^\.env(?:\.|$)/i
const gitTop=spawnSync('git',['rev-parse','--show-toplevel'],{cwd:root,encoding:'utf8',windowsHide:true})
const ownRepository=gitTop.status===0&&resolve(gitTop.stdout.trim()).toLowerCase()===resolve(root).toLowerCase()

// Rebuilding must not destroy a portable installation someone has already used.
export function checkOutput(folder){
  for(const path of ['data','.yican','app/data'])if(existsSync(resolve(folder,path)))throw Error('已有便携目录包含运行数据，请先将整个目录移到安全位置再构建：'+folder)
}
// Move-Item also handles directories that Windows refuses to rename through libuv.
export async function moveDirectory(from,to){
  for(const path of [from,to])if(![buildRoot,release].some(parent=>resolve(path).startsWith(parent+sep)))throw Error('拒绝移动发行与构建目录之外的路径')
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop"; Move-Item -LiteralPath $env:YICAN_MOVE_FROM -Destination $env:YICAN_MOVE_TO'],{env:{...process.env,YICAN_MOVE_FROM:resolve(from),YICAN_MOVE_TO:resolve(to)}})
}
function removeBuild(path){
  if(!resolve(path).startsWith(buildRoot+sep))throw Error('拒绝清理构建目录以外的路径')
  rmSync(path,{recursive:true,force:true,maxRetries:5,retryDelay:150})
}
export function sourceSnapshot(target){
  const git=spawnSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',windowsHide:true})
  if(ownRepository&&git.status===0){
    for(const relative of git.stdout.split('\0').filter(Boolean)){
      if(relative.split('/').some(part=>excluded.test(part)))throw Error('被跟踪的文件包含运行数据，已停止打包：'+relative)
      const dest=resolve(target,relative);mkdirSync(dirname(dest),{recursive:true});copyFileSync(resolve(root,relative),dest)
    }
    // Newly added packaging files must be included in the corresponding source.
    if(!existsSync(resolve(target,'scripts/package-portable.mjs')))throw Error('请先 git add 构建脚本，再生成便携包。')
  }else{
    for(const name of ['src','server','scripts','docs','public','content','licenses'])if(existsSync(resolve(root,name)))cpSync(resolve(root,name),resolve(target,name),{recursive:true,filter:path=>!excluded.test(path.split(/[\\/]/).at(-1))})
    for(const entry of readdirSync(root,{withFileTypes:true}))if(entry.isFile()&&/^(?:package(?:-lock)?\.json|tsconfig.*\.json|vite\.config\.ts|index\.html|README\.md|CHANGELOG\.md|LICENSE|\.gitattributes|\.gitignore|.*\.(?:cmd|ps1))$/.test(entry.name))copyFileSync(resolve(root,entry.name),resolve(target,entry.name))
  }
}
function cmd(action,args='',pause=false){
  return ['@echo off','setlocal','chcp 65001 >nul','cd /d "%~dp0"','set "NODE_OPTIONS="','if not exist "runtime\\node.exe" (','  echo Missing bundled runtime. Extract the entire ZIP before starting.','  if not defined YICAN_NO_PAUSE pause','  exit /b 1',')',`"runtime\\node.exe" "launcher.mjs" ${action} ${args} %*`,'set "result=%errorlevel%"',pause?'if not defined YICAN_NO_PAUSE pause':'if not "%result%"=="0" if not defined YICAN_NO_PAUSE pause','exit /b %result%',''].join('\r\n')
}
async function nodeLicense(){
  const version=process.version,local=resolve(root,'licenses','node-'+version+'.txt')
  if(existsSync(local))return readFileSync(local)
  const cache=resolve(buildRoot,'node-'+version+'-LICENSE.txt')
  if(existsSync(cache))return readFileSync(cache)
  const url='https://api.github.com/repos/nodejs/node/contents/LICENSE?ref='+version
  const response=await fetch(url,{headers:{'User-Agent':'Yican-portable-builder'},signal:AbortSignal.timeout(30_000)})
  if(!response.ok)throw Error('获取对应 Node.js 许可证失败：'+response.status+'；请将官方 '+version+' LICENSE 保存到 '+local)
  const data=await response.json(),text=Buffer.from(data.content??'','base64')
  if(!text.toString().includes('Node.js')||!text.toString().includes('Permission is hereby granted'))throw Error('Node.js 许可证内容无效')
  writeFileSync(cache,text);return text
}
async function zip(folder,file){
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command','$ErrorActionPreference="Stop"; Compress-Archive -LiteralPath $env:YICAN_ZIP_FOLDER -DestinationPath $env:YICAN_ZIP_FILE -CompressionLevel Optimal'],{cwd:root,env:{...process.env,YICAN_ZIP_FOLDER:folder,YICAN_ZIP_FILE:file}})
}
export async function main(){
  if(process.platform!=='win32'||process.arch!=='x64'||Number(process.versions.node.split('.')[0])<24)throw Error('请在 Windows x64 使用 Node.js 24+ 构建便携版。')
  const destination=resolve(release,appName)
  checkOutput(destination)
  mkdirSync(buildRoot,{recursive:true});mkdirSync(release,{recursive:true})
  const stage=resolve(buildRoot,'portable-'+randomUUID()),folder=resolve(stage,appName)
  mkdirSync(folder,{recursive:true})
  try{
    const source=resolve(folder,'source');mkdirSync(source);sourceSnapshot(source)
    const workspace=resolve(stage,'workspace');cpSync(source,workspace,{recursive:true})
    log('正在独立构建目录安装锁定依赖…\n')
    await run(process.execPath,[npmCli(),'ci','--include=dev','--no-audit','--no-fund'],{cwd:workspace,log,env:{...process.env,PATH:dirname(process.execPath)+';'+process.env.PATH,NODE_ENV:'development'}})
    log('正在检查类型并构建前端…\n')
    await run(process.execPath,[npmCli(),'run','build'],{cwd:workspace,log,env:{...process.env,PATH:dirname(process.execPath)+';'+process.env.PATH,NODE_ENV:'production'}})
    const {build,stop}=createRequire(resolve(workspace,'package.json'))('esbuild')
    const app=resolve(folder,'app');mkdirSync(resolve(app,'server'),{recursive:true})
    try{for(const entry of ['index','backup'])await build({entryPoints:[resolve(workspace,'server',entry+'.ts')],outfile:resolve(app,'server',entry+'.mjs'),bundle:true,platform:'node',format:'esm',target:'node24',packages:'bundle',legalComments:'inline'})}finally{stop()}
    copyFileSync(resolve(workspace,'server/schema.sql'),resolve(app,'server/schema.sql'))
    cpSync(resolve(workspace,'dist'),resolve(app,'dist'),{recursive:true})
    cpSync(resolve(workspace,'content'),resolve(app,'content'),{recursive:true})
    // Catalog startup validates source image hashes separately from the static dist tree.
    cpSync(resolve(workspace,'public'),resolve(app,'public'),{recursive:true})
    mkdirSync(resolve(app,'scripts'));copyFileSync(resolve(workspace,'scripts/deployment-common.mjs'),resolve(app,'scripts/deployment-common.mjs'))
    copyFileSync(resolve(workspace,'scripts/portable-launcher.mjs'),resolve(folder,'launcher.mjs'))
    mkdirSync(resolve(folder,'runtime'));copyFileSync(process.execPath,resolve(folder,'runtime/node.exe'))
    const licenses=resolve(folder,'licenses');mkdirSync(licenses)
    writeFileSync(resolve(licenses,'Node-LICENSE.txt'),await nodeLicense())
    for(const name of ['immer','zod','vue','lucide-vue-next','@vue/shared','@vue/reactivity','@vue/runtime-core','@vue/runtime-dom']){
      const source=resolve(workspace,'node_modules',name),license=['LICENSE','LICENSE.md','LICENSE.txt'].find(file=>existsSync(resolve(source,file)))
      if(!license)throw Error('未找到依赖许可证：'+name)
      copyFileSync(resolve(source,license),resolve(licenses,name.replaceAll('/','-')+'-LICENSE.txt'))
    }
    copyFileSync(resolve(root,'LICENSE'),resolve(folder,'LICENSE'))
    copyFileSync(resolve(root,'docs/HowToCook-LICENSE.txt'),resolve(licenses,'HowToCook-LICENSE.txt'))
    for(const [name,action,args,pause] of [['点我启动到局域网.cmd','start','',false],['点我启动.cmd','start','--local',false],['点我停止.cmd','stop','',true],['点我备份数据.cmd','backup','',true]])writeFileSync(resolve(folder,name),cmd(action,args,pause))
    copyFileSync(resolve(root,'docs/Windows便携版使用说明.md'),resolve(folder,'使用说明.md'))
    const git=(...args)=>{if(!ownRepository)return null;const r=spawnSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true});return r.status===0?r.stdout.trim():null}
    writeFileSync(resolve(folder,'portable.json'),JSON.stringify({format:'yican.portable',schemaVersion:1,version:readJson(resolve(root,'package.json')).version,commit:git('rev-parse','HEAD'),dirty:!!git('status','--porcelain'),builtAt:new Date().toISOString(),nodeVersion:process.version,nodeSha256:hash(resolve(folder,'runtime/node.exe')),platform:'win32-x64'},null,2)+'\n')
    const archive=resolve(stage,archiveName);log('正在生成便携 ZIP（含对应源码与许可证）…\n');await zip(folder,archive)
    const digest=hash(archive)
    // Publish only completed builds; refuse again in case the old output was started mid-build.
    checkOutput(destination)
    if(existsSync(destination))await moveDirectory(destination,resolve(stage,'previous-Yican'))
    try{await moveDirectory(folder,destination)}catch(error){if(existsSync(resolve(stage,'previous-Yican')))await moveDirectory(resolve(stage,'previous-Yican'),destination);throw error}
    copyFileSync(archive,resolve(release,archiveName))
    writeFileSync(resolve(release,'Yican-Windows-x64.sha256'),digest+'  '+archiveName+'\n')
    log('构建完成：'+resolve(release,archiveName)+'\nSHA-256：'+digest+'\n')
  }finally{removeBuild(stage)}
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))main().catch(error=>{console.error('便携版构建失败：'+error.message);process.exitCode=1})
