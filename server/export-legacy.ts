import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Store } from './store'
import { stateHash } from './relational'

// Exports CURRENT records and deduplication receipts, not the stale migration snapshot.
export function exportLegacy(source:string,destination:string){
  if(!existsSync(source))throw new Error('源数据库不存在，拒绝导出空白数据')
  if(existsSync(destination))throw new Error('目标文件已存在，拒绝覆盖')
  mkdirSync(dirname(destination),{recursive:true})
  const store=new Store(source),target=new DatabaseSync(destination)
  try{
    store.db.exec('BEGIN');const snapshot=store.snapshot()
    target.exec('BEGIN; CREATE TABLE kitchen_state(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL,body TEXT NOT NULL); CREATE TABLE requests(id TEXT PRIMARY KEY,body TEXT NOT NULL,result TEXT NOT NULL);')
    target.prepare('INSERT INTO kitchen_state VALUES(1,?,?)').run(snapshot.revision,JSON.stringify(snapshot.state))
    const insert=target.prepare('INSERT INTO requests VALUES(?,?,?)')
    let count=0
    for(const r of store.db.prepare('SELECT * FROM requests').iterate()){insert.run(r.id,r.body,r.result);count++}
    const copy=JSON.parse((target.prepare('SELECT body FROM kitchen_state').get() as {body:string}).body)
    if(stateHash(copy)!==stateHash(snapshot.state))throw new Error('回退导出校验失败')
    target.exec('COMMIT');store.db.exec('COMMIT')
    return {destination,revision:snapshot.revision,hash:stateHash(copy),requests:count}
  }finally{target.close();store.close()}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const source=resolve(process.env.YICAN_DATA_DIR||'data','kitchen.sqlite')
 const destination=resolve(process.argv[2]||`data/backups/rollback-current-${Date.now()}.sqlite`)
 console.log(JSON.stringify(exportLegacy(source,destination),null,2))
}
