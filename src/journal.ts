import { memberRole, type Meal, type Order, type Recipe, type State } from './domain'
import type { MealReview } from './reviews'

export interface JournalEntry {
  meal: Meal
  orders: Order[]
  dishes: { id: string; recipe?: Recipe; portions: number }[]
  reviews: MealReview[]
  confirmed: boolean
}

/** Historical orders are evidence of a menu, not proof that dinner was completed. */
export function mealJournal(state: State, kitchenId: string, userId: string, now: number): JournalEntry[] {
  if (!memberRole(state, userId, kitchenId)) return []
  const orders = new Map<string, Order[]>()
  for (const order of state.orders) {
    const list = orders.get(order.mealId) ?? []
    list.push(order)
    orders.set(order.mealId, list)
  }
  const recipes = new Map(state.recipes.map(r => [r.id, r]))
  const reviews = new Map<string, MealReview[]>()
  for (const review of state.reviews ?? []) {
    if (review.kitchenId !== kitchenId) continue
    const list = reviews.get(review.mealId) ?? []
    list.push(review)
    reviews.set(review.mealId, list)
  }
  return state.meals.filter(m => m.kitchenId === kitchenId && m.status !== 'cancelled' &&
    (m.status === 'done' || now >= +new Date(m.endsAt)))
    .flatMap(meal => {
      const mealOrders = orders.get(meal.id) ?? []
      const dishes = [...new Set(mealOrders.flatMap(o => o.recipeIds))]
        .filter(id => (meal.portions[id] ?? 1) > 0)
        .map(id => ({ id, recipe:recipes.get(id), portions:meal.portions[id] ?? 1 }))
      if (!dishes.length) return []
      return [{ meal, orders:mealOrders, dishes, reviews:(reviews.get(meal.id) ?? []).sort((a,b) => a.createdAt.localeCompare(b.createdAt)), confirmed:meal.status === 'done' }]
    }).sort((a,b) => a.meal.date.localeCompare(b.meal.date) || a.meal.startsAt.localeCompare(b.meal.startsAt) || a.meal.id.localeCompare(b.meal.id))
}

export function journalMonthSummary(entries: JournalEntry[], month: string) {
  const list = entries.filter(e => e.meal.date.startsWith(month + '-'))
  return { days:new Set(list.map(e => e.meal.date)).size, meals:list.length, dishes:list.reduce((n,e) => n + e.dishes.length, 0) }
}
