import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { freeze, produce, setAutoFreeze } from 'immer'
import type { State } from '../src/domain'
import { diffState, type StateChange } from '../src/sync'
import { applyCommand, CommandError, envelopeSchema } from './commands'
import { Relational } from './relational'

// Freeze cached records once so Immer can skip unchanged subtrees on later writes.
setAutoFreeze(true)
export interface Snapshot { state:State; revision:number; serverNow:number }
export interface SyncResponse { state?:State; revision:number; serverNow:number; fromRevision?:number; changes?:StateChange[] }
export class Store {
  db:DatabaseSync
  private repository:Relational
  private cached?:Snapshot
  private stateJson?:string
  private syncCache=new Map<number,{fromRevision:number;changes:StateChange[]}>()
  constructor(path:string,options:{seedDemo?:boolean}={}){
    if(path!==':memory:')mkdirSync(dirname(path),{recursive:true})
    this.db=new DatabaseSync(path)
    try{
      this.db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;')
      if(path!==':memory:'&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='kitchen_state'").get()){
        const folder=resolve(dirname(path),'backups');mkdirSync(folder,{recursive:true})
        // VACUUM INTO includes committed WAL records, unlike copying just the .sqlite file.
        const backupPath=resolve(folder,`pre-tables-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomUUID().slice(0,8)}.sqlite`)
        this.db.prepare('VACUUM INTO ?').run(backupPath)
      }
      this.repository=new Relational(this.db);this.repository.initialize(options.seedDemo??true)
    }catch(error){this.db.close();throw error}
  }
  private current(){
    const revision=Number(this.repository.meta().revision)
    if(this.cached?.revision!==revision){
      const ownTransaction=!this.db.isTransaction
      if(ownTransaction)this.db.exec('BEGIN')
      try{
        const revision=Number(this.repository.meta().revision),state=freeze(this.repository.read(),true)
        if(ownTransaction)this.db.exec('COMMIT')
        this.cached={revision,state,serverNow:Date.now()};this.stateJson=undefined;this.syncCache.clear()
      }catch(error){if(ownTransaction&&this.db.isTransaction)this.db.exec('ROLLBACK');throw error}
    }
    return this.cached!
  }
  private accept(state:State,revision:number){this.cached={state,revision,serverNow:Date.now()};this.stateJson=undefined;this.syncCache.clear()}
  snapshot():Snapshot {const s=this.current();return {...s,state:structuredClone(s.state),serverNow:Date.now()}}
  revision(){return this.current().revision}
  // Cached serialization: no SQL joins or recipe re-serialization on unchanged polls.
  fullJson(){const s=this.current();this.stateJson??=JSON.stringify(s.state);return `{"state":${this.stateJson},"revision":${s.revision},"serverNow":${Date.now()}}`}
  sync(since:number):SyncResponse {
    const snapshot=this.current(),base={revision:snapshot.revision,serverNow:Date.now()}
    if(since===snapshot.revision)return base
    const cached=this.syncCache.get(since);if(cached)return {...base,...cached}
    if(since>0&&since<snapshot.revision&&snapshot.revision-since<=200){
      const records=this.repository.rows('SELECT revision,body FROM sync_changes WHERE revision>? ORDER BY revision LIMIT 201',since)
      if(records.length===snapshot.revision-since&&records.every((r,i)=>r.revision===since+i+1)&&records.reduce((n,r)=>n+Buffer.byteLength(r.body),0)<=512000){
        const update={fromRevision:since,changes:records.map(r=>JSON.parse(r.body) as StateChange)}
        if(this.syncCache.size>=32)this.syncCache.delete(this.syncCache.keys().next().value!)
        this.syncCache.set(since,update);return {...base,...update}
      }
    }
    return this.snapshot()
  }
  private persist(before:State,state:State,revision:number){
    const change=diffState(before,state)
    this.repository.write(before,state,change,revision)
    this.repository.run('INSERT INTO sync_changes VALUES(?,?,?)',revision,JSON.stringify(change),Date.now())
    if(revision%100===0)this.repository.run('DELETE FROM sync_changes WHERE revision<=?',revision-2000)
  }
  execute(raw:unknown):Snapshot&{result:Record<string,string>}
  execute(raw:unknown,since:number):SyncResponse&{result:Record<string,string>}
  execute(raw:unknown,since?:number):SyncResponse&{result:Record<string,string>} {
    const envelope=envelopeSchema.parse(raw),body=JSON.stringify(envelope)
    this.db.exec('BEGIN IMMEDIATE')
    let result:Record<string,string>
    try{
      const prior=this.repository.stmt('SELECT body,result FROM requests WHERE id=?').get(envelope.requestId) as {body:string;result:string}|undefined
      if(prior){if(prior.body!==body)throw new CommandError('请求编号已使用',409);result=JSON.parse(prior.result)}
      else{
        const before=this.current(),next=produce(before.state,draft=>{result=applyCommand(draft,envelope.actor,envelope.command)})
        this.persist(before.state,next,before.revision+1)
        this.repository.run('INSERT INTO requests VALUES(?,?,?)',envelope.requestId,body,JSON.stringify(result!))
        this.db.exec('COMMIT');this.accept(next,before.revision+1)
        return {...(since===undefined?this.snapshot():this.sync(since)),result:result!}
      }
      this.db.exec('COMMIT')
    }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error}
    return {...(since===undefined?this.snapshot():this.sync(since)),result:result!}
  }
  // Maintenance/imports use the same transaction, constraints and sync change log.
  update<T>(mutate:(state:State)=>T):T {
    this.db.exec('BEGIN IMMEDIATE')
    try{
      const before=this.current();let result!:T
      const next=produce(before.state,draft=>{result=mutate(draft)})
      this.persist(before.state,next,before.revision+1);this.db.exec('COMMIT');this.accept(next,before.revision+1)
      return result
    }catch(error){if(this.db.isTransaction)this.db.exec('ROLLBACK');throw error}
  }
  close(){this.db.close()}
}
