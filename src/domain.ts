export type Role = 'chef' | 'diner'
export type JoinRole = Role | 'guest'
export interface Person { name:string; short:string; color:string }
export interface Ingredient { name: string; amount: number | null; unit: string; type: 'food' | 'seasoning' }
export interface RecipeOrigin { provider:'howtocook'; repository:string; commit:string; path:string }
export interface RecipeCoverInfo { art:string; kind:'original'|'substituted'|'generated'|'illustration'|'uncertain'; sourcePageUrl?:string; sourceImageUrl?:string; license?:string; licenseUrl?:string; matchReason?:string }
export interface Recipe { reviewKey?: string; id: string; name: string; category: string; minutes: number | null; servings: number | null; note: string; art: string; ingredients: Ingredient[]; steps: string[]; source?: string; sourceText?: string; origin?:RecipeOrigin; coverInfo?:RecipeCoverInfo; archived?: boolean }
export interface Kitchen { id: string; name: string; subtitle: string; chefId: string | null; ownerId: string; dinerOwnerId?:string|null; archived?:boolean; chefLabel: string; dinerLabel: string; recipeIds: string[] }
export interface Member { userId: string; kitchenId: string; role: Role }
export interface Grant { userId: string; mealId: string; revoked?: boolean }
export interface Meal { id: string; kitchenId: string; date: string; name: string; startsAt: string; endsAt: string; deadline: string; status: 'open' | 'prep' | 'cooking' | 'done' | 'cancelled'; portions: Record<string, number> }
export interface Order { id: string; userId: string; mealId: string; recipeIds: string[]; note: string; createdAt: string }
export interface Stock extends Ingredient { id: string; kitchenId: string }
export interface Invite { id: string; kitchenId: string; type: 'long' | 'temporary'; mealId?: string; expiresAt: string; revoked?:boolean }
export interface State { bundledCatalog?:string; people?:Record<string,Person>; reviews?: import('./reviews').MealReview[]; testMenuVersion?: number; recipeMarks?: import('./preferences').RecipeMarks; version: number; kitchens: Kitchen[]; members: Member[]; grants: Grant[]; recipes: Recipe[]; meals: Meal[]; orders: Order[]; stock: Stock[]; invites: Invite[]; checked: Record<string, string>; feedback: { id: string; type: string; text: string; createdAt: string; userId?:string }[] }
export const people: Record<string, { name: string; short: string; color: string }> = {
  lin: { name: '小禾', short: '禾', color: '#c46f51' }, chen: { name: '小川', short: '川', color: '#6d836b' }, guest: { name: '小满', short: '满', color: '#a38656' }
}
export function dateKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
export function memberRole(s: State, userId: string, kitchenId: string): Role | undefined { return s.members.find(m => m.userId === userId && m.kitchenId === kitchenId)?.role }
export function dinerOwner(s:State,kitchen:Kitchen) {return kitchen.dinerOwnerId===undefined?s.members.find(m=>m.kitchenId===kitchen.id&&m.role==='diner')?.userId??null:kitchen.dinerOwnerId}
export function isKitchenHost(s:State,userId:string,kitchen:Kitchen) {return !kitchen.archived&&memberRole(s,userId,kitchen.id)!==undefined&&(kitchen.chefId===userId||dinerOwner(s,kitchen)===userId)}
export function activeGrant(s: State, userId: string, mealId: string, now: number) {
  const meal = s.meals.find(m => m.id === mealId)
  return !!meal && !!s.kitchens.find(k=>k.id===meal.kitchenId&&!k.archived) && meal.status !== 'cancelled' && now < +new Date(meal.endsAt) && s.grants.some(g => g.userId === userId && g.mealId === mealId && !g.revoked)
}
export function hasAccess(s: State, userId: string, meal: Meal, now: number) { return !!s.kitchens.find(k=>k.id===meal.kitchenId&&!k.archived)&&(!!memberRole(s, userId, meal.kitchenId) || activeGrant(s, userId, meal.id, now)) }
export function canOrder(s: State, userId: string, meal: Meal, now: number) {
  return hasAccess(s, userId, meal, now) && !!s.kitchens.find(k => k.id === meal.kitchenId)?.chefId && meal.status === 'open' && now < +new Date(meal.deadline) && now < +new Date(meal.endsAt)
}
export function visibleKitchens(s: State, userId: string, now: number) { return s.kitchens.filter(k => !k.archived&&(memberRole(s, userId, k.id) || s.meals.some(m => m.kitchenId === k.id && activeGrant(s, userId, m.id, now)))) }
export function acceptInvite(s: State, inviteId: string, userId: string, role: JoinRole, now: number): string | null {
  const inv = s.invites.find(i => i.id === inviteId)
  if (!inv || inv.revoked || now >= +new Date(inv.expiresAt)) return '邀请已过期或撤销'
  const kitchen = s.kitchens.find(k => k.id === inv.kitchenId)
  if (!kitchen || kitchen.archived) return '厨房不存在或已解散'
  if (inv.type === 'temporary') {
    const meal = s.meals.find(m => m.id === inv.mealId)
    if (!meal || now >= +new Date(meal.endsAt) || meal.status !== 'open' || now >= +new Date(meal.deadline)) return '本餐已停止接受邀请'
    if (role === 'chef') return '单餐邀请仅加入为食客'
    if (!memberRole(s, userId, kitchen.id) && !activeGrant(s, userId, meal.id, now)) {
      const old=s.grants.find(g=>g.userId===userId&&g.mealId===meal.id)
      if(old)old.revoked=false
      else s.grants.push({ userId, mealId: meal.id })
    }
  } else if (!memberRole(s, userId, kitchen.id)) {
    if (role === 'chef' && kitchen.chefId) return '这个厨房已经有主厨了'
    if(role==='diner'&&dinerOwner(s,kitchen))return '这个厨房已经有点菜主人了，请以客人身份加入'
    kitchen.dinerOwnerId=dinerOwner(s,kitchen)
    s.members.push({ userId, kitchenId: kitchen.id, role:role==='guest'?'diner':role })
    if (role === 'chef') kitchen.chefId = userId
    if (role === 'diner') kitchen.dinerOwnerId = userId
  }
  return null
}
function normalized(i: Ingredient) {
  const aliases: Record<string, string> = { '西红柿': '番茄' }
  const conversions:Record<string,[string,number]> = {'千克':['克',1000],'斤':['克',500],'两':['克',50],'升':['毫升',1000]}
  const [unit,factor] = conversions[i.unit]??[i.unit,1]
  const amount = i.amount === null ? null : i.amount * factor
  return { ...i, name: aliases[i.name] || i.name, unit, amount }
}
export interface ShoppingRow { key: string; name: string; amount: number | null; unit: string; available: number | null; shortage: number | null; status: 'enough' | 'missing' | 'unknown'; sources: { name: string; amount: number | null }[]; type: string; signature: string }
export function shoppingList(s: State, meal: Meal): ShoppingRow[] {
  const ids = [...new Set(s.orders.filter(o => o.mealId === meal.id).flatMap(o => o.recipeIds))]
  const rows = new Map<string, ShoppingRow>()
  for (const id of ids) {
    const r = s.recipes.find(r => r.id === id)
    if (!r) continue
    const portions = meal.portions[id] ?? 1
    if (portions <= 0) continue
    for (const raw of r.ingredients) {
      const i = normalized(raw), key = `${i.name}|${i.unit}`
      const amount = i.amount === null ? null : Math.round(i.amount * portions * 100) / 100
      let row = rows.get(key)
      if (!row) { row = { key, name: i.name, amount: 0, unit: i.unit, available: 0, shortage: 0, status: 'missing', sources: [], type: i.type, signature: '' }; rows.set(key, row) }
      row.amount = row.amount === null || amount === null ? null : row.amount + amount
      row.sources.push({ name: r.name, amount })
    }
  }
  for (const row of rows.values()) {
    const matching = s.stock.filter(x => x.kitchenId === meal.kitchenId).map(normalized).filter(x => x.name === row.name)
    const compatible = matching.filter(x => x.unit === row.unit)
    if (!matching.length) { row.status = 'missing'; row.shortage = row.amount; row.available = 0 }
    else if (row.amount === null) { row.status = 'unknown'; row.available = null; row.shortage = null }
    else if (!compatible.length || compatible.some(x => x.amount === null)) { row.status = 'unknown'; row.available = null; row.shortage = null }
    else {
      row.available = compatible.reduce((n, x) => n + (x.amount || 0), 0)
      row.shortage = Math.max(0, Math.round((row.amount - row.available) * 100) / 100)
      row.status = row.shortage === 0 ? 'enough' : 'missing'
    }
    row.signature = `${row.amount}|${row.available}|${row.sources.map(x => `${x.name}:${x.amount}`).join(',')}`
  }
  return [...rows.values()].sort((a, b) => ({ missing: 0, unknown: 1, enough: 2 }[a.status] - { missing: 0, unknown: 1, enough: 2 }[b.status]))
}
export function isPrepared(s: State, mealId: string, row: ShoppingRow) {
  const manual = s.checked[`${mealId}:${row.key}`]
  if (manual === `no:${row.signature}`) return false
  return row.status === 'enough' || manual === `yes:${row.signature}`
}
