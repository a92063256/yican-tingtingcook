import { backup, DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { Store } from './store'
import { stateHash } from './relational'

const source=resolve(process.env.YICAN_DATA_DIR||'data','kitchen.sqlite')
if(!existsSync(source))throw new Error('源数据库不存在，取消迁移')
const apply=process.argv.includes('--apply')
const timestamp=new Date().toISOString().replace(/[:.]/g,'-')
const target=apply?source:resolve(dirname(source),'migration-rehearsals',`${timestamp}.sqlite`)
if(!apply){mkdirSync(dirname(target),{recursive:true});const input=new DatabaseSync(source,{readOnly:true});try{await backup(input,target)}finally{input.close()}}
const store=new Store(target)
try{
 const snapshot=store.snapshot(),integrity=store.db.prepare('PRAGMA integrity_check').all(),foreignKeys=store.db.prepare('PRAGMA foreign_key_check').all()
 const report={mode:apply?'applied':'rehearsal',source,target,revision:snapshot.revision,hash:stateHash(snapshot.state),integrity,foreignKeys,migration:store.db.prepare('SELECT * FROM migration_audit').all(),tables:store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all(),requests:store.db.prepare('SELECT COUNT(*) AS count FROM requests').get()}
 mkdirSync(resolve(dirname(source),'migration-reports'),{recursive:true})
 writeFileSync(resolve(dirname(source),'migration-reports',`${timestamp}.json`),JSON.stringify(report,null,2))
 console.log(JSON.stringify(report,null,2))
 if(foreignKeys.length||integrity.some(row=>row.integrity_check!=='ok'))throw new Error('数据库完整性检查失败')
}finally{store.close()}
