import { afterEach, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const scratch=[],scripts=fileURLToPath(new URL('./',import.meta.url))
afterEach(()=>{for(const root of scratch.splice(0))rmSync(root,{recursive:true,force:true})})
async function fixture(git=false){
  const root=mkdtempSync(resolve(tmpdir(),'yican-source-'));scratch.push(root)
  const put=(path,text='example')=>{const file=resolve(root,path);mkdirSync(resolve(file,'..'),{recursive:true});writeFileSync(file,text)}
  mkdirSync(resolve(root,'scripts'))
  for(const file of ['package-portable.mjs','deployment-common.mjs'])copyFileSync(resolve(scripts,file),resolve(root,'scripts',file))
  put('src/example.ts');put('README.md');put('AGENTS.md');put('docs/AGENTS.md');put('src/.env');put('src/private.key');put('src/backup.db');put('docs/note.md')
  if(git)execFileSync('git',['init','--quiet'],{cwd:root,windowsHide:true})
  const module=await import(pathToFileURL(resolve(root,'scripts/package-portable.mjs')).href)
  const target=resolve(root,'snapshot');mkdirSync(target)
  return {root,target,put,snapshot:()=>module.sourceSnapshot(target)}
}
it('keeps local instructions, credentials and databases out of a source ZIP build without Git',async()=>{
  const {target,snapshot}=await fixture();snapshot()
  for(const file of ['AGENTS.md','docs/AGENTS.md','src/.env','src/private.key','src/backup.db'])expect(existsSync(resolve(target,file)),file).toBe(false)
  for(const file of ['src/example.ts','docs/note.md','README.md','scripts/package-portable.mjs'])expect(existsSync(resolve(target,file)),file).toBe(true)
})
it('takes only tracked Git sources and rejects a mistakenly tracked local instruction file',async()=>{
  const {root,target,snapshot}=await fixture(true)
  execFileSync('git',['add','src/example.ts','README.md','scripts','docs/note.md'],{cwd:root,windowsHide:true});snapshot()
  expect(existsSync(resolve(target,'src/example.ts'))).toBe(true)
  expect(existsSync(resolve(target,'AGENTS.md'))).toBe(false)
  execFileSync('git',['add','AGENTS.md'],{cwd:root,windowsHide:true})
  expect(snapshot).toThrow('包含运行数据')
})
