import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Store } from './store'
import { Accounts } from './auth'
import { initializeBundledCatalog } from './bundled-catalog'

// Run migrations and content initialization without opening any network listener.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..')
const store=new Store(resolve(process.env.YICAN_DATA_DIR||resolve(root,'data'),'kitchen.sqlite'),{seedDemo:false})
try {
  new Accounts(store)
  const catalog=initializeBundledCatalog(store)
  const integrity=store.db.prepare('PRAGMA integrity_check').get()
  if(integrity?.integrity_check!=='ok'||store.db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('更新后的数据库完整性检查失败')
  console.log(JSON.stringify({ok:true,catalog,revision:store.revision()}))
} finally {store.close()}
