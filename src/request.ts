/** Use AbortController for browsers without AbortSignal.timeout, including HTTP LAN access. */
export async function requestJson(url:string,init:Omit<RequestInit,'signal'>,timeoutMs:number) {
  const controller=new AbortController()
  const timer=setTimeout(()=>controller.abort(),timeoutMs)
  try {
    const response=await fetch(url,{...init,cache:'no-store',signal:controller.signal})
    const body=await response.json()
    return {response,body}
  } catch {
    throw new Error('暂时连接不到厨房，请确认电脑上的服务正在运行')
  } finally {
    clearTimeout(timer)
  }
}
