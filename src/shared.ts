import { ref } from 'vue'
import type { State } from './domain'
import { applyStateChange, type StateChange } from './sync'
import type { Command } from '../server/commands'
import { accountExpired } from './account'
import { people } from './domain'
import { requestJson } from './request'
export interface Snapshot {state?:State;revision:number;serverNow:number;fromRevision?:number;changes?:StateChange[];result?:Record<string,string>}
declare global { interface Window {__YICAN_LAN__?:boolean;__YICAN_BOOT__?:Snapshot} }
export const lanEnabled=true
export const sharedStatus=ref<'connecting'|'online'|'offline'>(lanEnabled?'connecting':'online')
export const sharedBusy=ref(false)
export const serverOffset=ref(0)
export const fingerprint=(value:unknown)=>value==null?null:JSON.stringify(value)
export function newId(){
 const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
 const s=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${s.slice(0,8)}-${s.slice(8,12)}-${s.slice(12,16)}-${s.slice(16,20)}-${s.slice(20)}`
}
async function request(url:string,init?:RequestInit){
 const {response,body}=await requestJson(url,init??{},10000)
 if(response.headers.has('X-Server-Time'))body.serverNow=Number(response.headers.get('X-Server-Time'))
 if(!response.ok){if(response.status===401)accountExpired.value=true;const error=new Error(body.error||'服务请求失败') as Error&{status?:number};error.status=response.status;throw error}
 return body as Snapshot
}
export async function bootstrap(){if(lanEnabled){window.__YICAN_BOOT__=await request('/api/state');Object.assign(people,window.__YICAN_BOOT__.state?.people??{});sharedStatus.value='online';serverOffset.value=window.__YICAN_BOOT__.serverNow-Date.now()}}
export function connectShared(state:State){
 let revision=window.__YICAN_BOOT__?.revision||0,reading=false,stopped=false
 const requests=new Map<string,string>()
 const receive=(snapshot:Snapshot)=>{
  serverOffset.value=snapshot.serverNow-Date.now()
  if(snapshot.state||snapshot.revision>revision){
   Object.assign(people,snapshot.state?.people??{})
   if(snapshot.state)Object.assign(state,snapshot.state)
   else if(snapshot.fromRevision===revision&&snapshot.changes)for(const change of snapshot.changes)applyStateChange(state,change)
   else return false
   revision=snapshot.revision
  }
  sharedStatus.value='online';return true
 }
 const refresh=async()=>{if(!lanEnabled||reading||sharedBusy.value||stopped)return;reading=true;try{if(!receive(await request('/api/state?since='+revision)))receive(await request('/api/state'))}catch{sharedStatus.value='offline'}finally{reading=false}}
 const visible=()=>{if(!document.hidden)void refresh()}
 const timer=lanEnabled?window.setInterval(visible,2000):undefined
 if(lanEnabled){window.addEventListener('online',visible);document.addEventListener('visibilitychange',visible)}
 return {
  refresh,
  async send(actor:string,command:Command){
   if(sharedBusy.value)throw new Error('上一项操作正在保存，请稍候')
   const key=JSON.stringify({actor,command}),requestId=requests.get(key)||newId();requests.set(key,requestId)
   sharedBusy.value=true
   try{const snapshot=await request('/api/commands?since='+revision,{method:'POST',headers:{'Content-Type':'application/json','X-Yican-Request':'1'},body:JSON.stringify({requestId,actor,command})});if(!receive(snapshot))receive(await request('/api/state'));requests.delete(key);return snapshot.result||{}}
   catch(error){const e=error as Error&{status?:number};if(e.status){requests.delete(key);throw e}sharedStatus.value='offline';throw new Error('连接中断，保存结果尚未确认。输入已保留，请恢复连接后重试。')}
   finally{sharedBusy.value=false;void refresh()}
  },
  stop(){stopped=true;clearInterval(timer);window.removeEventListener('online',visible);document.removeEventListener('visibilitychange',visible)}
 }
}
