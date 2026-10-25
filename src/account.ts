import { ref } from 'vue'
import { requestJson } from './request'

export interface Account {id:string;username:string;nickname:string;passwordless:boolean;preferredRole:'chef'|'diner'}
export interface Invitation {id:string;kitchenId:string;kitchenName:string;type:'long'|'temporary';expiresAt:string;mealName?:string;mealDate?:string;startsAt?:string;chefAvailable:boolean;dinerAvailable:boolean}
export const account=ref<Account|null>(null)
export const accountExpired=ref(false)
export async function accountRequest<T>(path:string,body?:unknown):Promise<T> {
  const {response,body:value}=await requestJson(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:body===undefined?undefined:{'Content-Type':'application/json','X-Yican-Request':'1'},body:body===undefined?undefined:JSON.stringify(body)},15000)
  if(!response.ok){if(response.status===401&&account.value)accountExpired.value=true;throw new Error(value.error??'保存失败，请稍后重试')}
  return value
}
export async function logout(){await accountRequest('/api/auth/logout',{});account.value=null;accountExpired.value=true}
