import { backup, DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const data=resolve(process.env.YICAN_DATA_DIR||resolve(root,'data'))
const path=resolve(data,'kitchen.sqlite')
if(!existsSync(path))throw new Error('数据库尚未创建，请先启动一次服务')
mkdirSync(resolve(data,'backups'),{recursive:true})
const output=resolve(data,'backups',`kitchen-${new Date().toISOString().replace(/[:.]/g,'-')}.sqlite`)
const db=new DatabaseSync(path)
try{await backup(db,output);console.log('备份已保存：'+output)}finally{db.close()}
