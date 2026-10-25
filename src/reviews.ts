import { memberRole, type Meal, type Recipe, type State } from './domain'

export interface MealReview {
  id: string
  kitchenId: string
  mealId: string
  userId: string
  recipeId: string | null
  recipeKey: string | null
  text: string
  createdAt: string
  updatedAt: string
}

export const reviewTextLimit = 500
export function reviewRecipes(state: State, meal: Meal): Recipe[] {
  const ids = new Set(state.orders.filter(o => o.mealId === meal.id).flatMap(o => o.recipeIds))
  return state.recipes.filter(r => ids.has(r.id) && (meal.portions[r.id] ?? 1) > 0)
}
export function canReadMealReviews(state: State, userId: string, meal: Meal) {
  if (!state.kitchens.some(k=>k.id===meal.kitchenId&&!k.archived)) return false
  if (memberRole(state, userId, meal.kitchenId)) return true
  return state.orders.some(o => o.userId === userId && o.mealId === meal.id) &&
    state.grants.some(g => g.userId === userId && g.mealId === meal.id && !g.revoked)
}
export function canReviewMeal(state: State, userId: string, meal: Meal, now: number) {
  return canReadMealReviews(state, userId, meal) && meal.status !== 'cancelled' &&
    (meal.status === 'done' || now >= +new Date(meal.endsAt)) && reviewRecipes(state, meal).length > 0
}
export function recipeReviews(state: State, kitchenId: string, recipe: Recipe, userId: string) {
  return (state.reviews ?? []).filter(r => r.kitchenId === kitchenId && r.recipeKey === (recipe.reviewKey ?? recipe.id) &&
    state.meals.some(m => m.id === r.mealId && canReadMealReviews(state, userId, m)))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
}
