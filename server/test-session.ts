import type { Store } from './store'
import { people } from '../src/domain'

/** Provision a known fixture account, then exercise the real login HTTP interface. */
export async function fixtureSession(store:Store,base:string,id:string) {
  store.db.prepare('INSERT OR IGNORE INTO accounts VALUES(?,?,?,?,?,?,?)').run(id,'test_'+id,people[id]?.name??id,null,1,id==='chen'?'chef':'diner',Date.now())
  const response=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1'},body:JSON.stringify({identifier:'test_'+id,passwordless:true})})
  if(!response.ok)throw new Error('Fixture login failed: '+await response.text())
  return response.headers.get('set-cookie')!.split(';')[0]
}
