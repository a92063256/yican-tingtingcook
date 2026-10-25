import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

if(Number(process.versions.node.split('.')[0])<24){
  console.error('一餐需要 Node.js 24 或更新版本，以使用内置 SQLite。')
  process.exit(1)
}
const cwd=fileURLToPath(new URL('../',import.meta.url))
const children=[]
let stopping=false
function stop(code=0){
  if(stopping)return
  stopping=true
  for(const child of children)child.kill('SIGTERM')
  process.exitCode=code
}
function run(args,env){
  const child=spawn(process.execPath,args,{cwd,env,stdio:'inherit',windowsHide:true})
  children.push(child)
  child.on('error',error=>{console.error(error.message);stop(1)})
  child.on('exit',code=>{if(!stopping)stop(code??1)})
}
// Keep development local even if the parent terminal has deployment environment variables.
run(['--import','tsx','server/index.ts'],{...process.env,YICAN_HOST:'127.0.0.1',YICAN_PORT:'3000'})
run(['node_modules/vite/bin/vite.js',...process.argv.slice(2),'--host','127.0.0.1','--strictPort'],process.env)
process.on('SIGINT',()=>stop())
process.on('SIGTERM',()=>stop())
