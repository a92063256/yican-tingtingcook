import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

// Stable bootstrap: later updates load their own manager from the selected release.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
try {
  if(Number(process.versions.node.split('.')[0])<24)throw new Error('需要 Node.js 24 或更新版本。')
  let release=root
  const file=resolve(root,'.yican/current.json')
  if(existsSync(file)){
    const current=JSON.parse(readFileSync(file,'utf8'))
    if(!/^[a-f0-9]{40,64}-[a-f0-9]{8}$/.test(current.release))throw new Error('已安装版本记录无效，请保留 .yican 目录并检查更新日志。')
    release=resolve(root,'.yican/releases',current.release)
    if(!release.startsWith(resolve(root,'.yican/releases')+sep))throw new Error('版本路径无效')
  }
  const {main}=await import(pathToFileURL(resolve(release,'scripts/deployment.mjs')))
  await main(root,process.argv.slice(2))
} catch(error){console.error('一餐：'+error.message);process.exitCode=1}
