import { describe, expect, it } from 'vitest'
import { createSeed } from './seed'
import { acceptInvite, activeGrant, canOrder, isPrepared, memberRole, shoppingList, visibleKitchens } from './domain'

describe('餐次和临时身份', () => {
  it('只授权指定餐次，到期立即失效且保留订单', () => {
    const s=createSeed(), meal=s.meals.find(m=>m.id==='home-1-1')!, before=+new Date(meal.deadline)-1000
    s.grants.push({userId:'guest',mealId:meal.id})
    expect(canOrder(s,'guest',meal,before)).toBe(true)
    expect(canOrder(s,'guest',s.meals.find(m=>m.id==='home-1-0')!,before)).toBe(false)
    expect(activeGrant(s,'guest',meal.id,+new Date(meal.endsAt))).toBe(false)
    expect(s.orders.length).toBe(1)
  })
  it('点菜截止后仍可查看本餐，但无法提交', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    s.grants.push({userId:'guest',mealId:m.id})
    const n=+new Date(m.deadline)+1
    expect(activeGrant(s,'guest',m.id,n)).toBe(true)
    expect(canOrder(s,'guest',m,n)).toBe(false)
  })
  it('两餐授权独立，第一餐到期不会移除第二餐', () => {
    const s=createSeed(),a=s.meals.find(m=>m.id==='home-1-1')!,b=s.meals.find(m=>m.id==='home-2-1')!
    s.grants.push({userId:'guest',mealId:a.id},{userId:'guest',mealId:b.id})
    const n=+new Date(a.endsAt)+1
    expect(activeGrant(s,'guest',a.id,n)).toBe(false)
    expect(activeGrant(s,'guest',b.id,n)).toBe(true)
    expect(visibleKitchens(s,'guest',n).map(k=>k.id)).toEqual(['home'])
  })
  it('已有长期成员接受单餐邀请不会降级', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    s.invites.push({id:'x',type:'temporary',kitchenId:'home',mealId:m.id,expiresAt:m.endsAt})
    expect(acceptInvite(s,'x','lin','diner',+new Date(m.deadline)-1)).toBe(null)
    expect(s.grants.length).toBe(0)
    expect(memberRole(s,'lin','home')).toBe('diner')
    expect(visibleKitchens(s,'lin',+new Date(m.endsAt)+1).some(k=>k.id==='home')).toBe(true)
  })
  it('主厨已被占用时不能再加入一名主厨', () => {
    const s=createSeed(),n=Date.now()
    s.invites.push({id:'x',type:'long',kitchenId:'home',expiresAt:new Date(n+86400000).toISOString()})
    expect(acceptInvite(s,'x','guest','chef',n)).toBe('这个厨房已经有主厨了')
    expect(s.members.filter(m=>m.kitchenId==='home'&&m.role==='chef')).toHaveLength(1)
  })
})
describe('食材与库存', () => {
  it('同一道菜多人点单，不会未经主厨确认就累加份数', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    s.orders.push({id:'o2',userId:'guest',mealId:m.id,recipeIds:['tomato'],note:'',createdAt:new Date().toISOString()})
    const r=shoppingList(s,m).find(r=>r.name==='番茄')!
    expect(r.amount).toBe(500);expect(r.shortage).toBe(300);expect(r.sources).toHaveLength(2)
  })
  it('库存充足自动勾选，份数增加后会重新计算', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    let egg=shoppingList(s,m).find(r=>r.name==='鸡蛋')!
    expect(isPrepared(s,m.id,egg)).toBe(true)
    m.portions.tomato=2
    egg=shoppingList(s,m).find(r=>r.name==='鸡蛋')!
    expect(egg.shortage).toBe(1);expect(isPrepared(s,m.id,egg)).toBe(false)
  })
  it('手工备齐标记在数量变化后失效', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    const r=shoppingList(s,m).find(r=>r.name==='番茄')!
    s.checked[`${m.id}:${r.key}`]=`yes:${r.signature}`
    expect(isPrepared(s,m.id,r)).toBe(true)
    m.portions.tomato=2
    expect(isPrepared(s,m.id,shoppingList(s,m).find(r=>r.name==='番茄')!)).toBe(false)
  })
  it('个与克不强行换算，数量未知不标记为充足', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    s.stock.find(s=>s.name==='番茄')!.unit='个'
    expect(shoppingList(s,m).find(r=>r.name==='番茄')!.status).toBe('unknown')
    expect(shoppingList(s,m).find(r=>r.name==='小葱')!.status).toBe('unknown')
  })
  it('千克按克换算并合并同义食材', () => {
    const s=createSeed(),m=s.meals.find(m=>m.id==='home-1-1')!
    const tomato=s.stock.find(s=>s.name==='番茄')!;tomato.name='西红柿';tomato.amount=.6;tomato.unit='千克'
    const r=shoppingList(s,m).find(r=>r.name==='番茄')!
    expect(r.available).toBe(600);expect(r.status).toBe('enough')
  })
})
