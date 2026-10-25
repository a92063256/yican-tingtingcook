import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { account, accountExpired, accountRequest } from './account'
import { bootstrap } from './shared'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('AbortSignal', class {})
  vi.stubGlobal('window', {})
  account.value=null
  accountExpired.value=false
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
  account.value=null
  accountExpired.value=false
})
function response(body:unknown,ok=true) {
  return {ok,status:ok?200:401,headers:new Headers(),json:async()=>body}
}

it('loads the login screen without AbortSignal.timeout',async()=>{
  const fetch=vi.fn().mockResolvedValue(response({user:null,firstAccount:true}))
  vi.stubGlobal('fetch',fetch)
  await expect(accountRequest('/api/auth/me')).resolves.toEqual({user:null,firstAccount:true})
  expect(fetch).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

it('loads kitchen state after login without AbortSignal.timeout',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({state:{people:{}},revision:1,serverNow:Date.now()})))
  await bootstrap()
  expect(window.__YICAN_BOOT__?.revision).toBe(1)
  expect(vi.getTimerCount()).toBe(0)
})

it('aborts a stalled account request after 15 seconds and clears its timer',async()=>{
  let signal:AbortSignal
  vi.stubGlobal('fetch',vi.fn((_url,init)=>new Promise((_resolve,reject)=>{
    signal=init.signal
    signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})
  })))
  const pending=accountRequest('/api/auth/me').catch(error=>error)
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toMatchObject({message:expect.stringContaining('暂时连接不到厨房')})
  expect(signal!.aborted).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps the timeout active while reading a slow response body',async()=>{
  vi.stubGlobal('fetch',vi.fn(async(_url,init)=>({
    ok:true,headers:new Headers(),json:()=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true})
    }),
  })))
  const pending=accountRequest('/api/auth/me').catch(error=>error)
  await vi.advanceTimersByTimeAsync(15000)
  expect(await pending).toMatchObject({message:expect.stringContaining('暂时连接不到厨房')})
  expect(vi.getTimerCount()).toBe(0)
})

it('preserves server errors and account expiry without a pending timer',async()=>{
  account.value={id:'user-test',username:'test',nickname:'测试',passwordless:true,preferredRole:'chef'}
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(response({error:'请先登录'},false)))
  await expect(accountRequest('/api/auth/security',{})).rejects.toThrow('请先登录')
  expect(accountExpired.value).toBe(true)
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the timeout on network failure',async()=>{
  vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
  await expect(accountRequest('/api/auth/me')).rejects.toThrow('暂时连接不到厨房')
  expect(vi.getTimerCount()).toBe(0)
})
