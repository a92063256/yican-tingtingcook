import type { State } from './domain'

export interface RecipeMarks {
  signatures: Record<string, string[]>
  favorites: Record<string, string[]>
}
export const emptyMarks = (): RecipeMarks => ({ signatures: {}, favorites: {} })
export const favoriteKey = (kitchenId: string, userId: string) => `${kitchenId}:${userId}`
export function toggleMark(records: Record<string, string[]>, key: string, recipeId: string) {
  const list = records[key] ?? []
  records[key] = list.includes(recipeId) ? list.filter(id => id !== recipeId) : [...list, recipeId]
}
export function migrateRecipeMarks(marks: RecipeMarks, kitchenId: string, oldId: string, newId: string) {
  const replace = (ids: string[]) => [...new Set(ids.map(id => id === oldId ? newId : id))]
  if (marks.signatures[kitchenId]) marks.signatures[kitchenId] = replace(marks.signatures[kitchenId])
  for (const key of Object.keys(marks.favorites)) {
    if (key.startsWith(`${kitchenId}:`)) marks.favorites[key] = replace(marks.favorites[key])
  }
}
export function dateOrderMark(state: State, mealIds: string[], userId: string) {
  const orders = state.orders.filter(order => mealIds.includes(order.mealId))
  return { mine: orders.some(order => order.userId === userId), others: orders.some(order => order.userId !== userId) }
}
export function monthCells(month: string): (string | null)[] {
  const [year, number] = month.split('-').map(Number)
  const first = new Date(year, number - 1, 1, 12)
  const offset = (first.getDay() + 6) % 7
  const count = new Date(year, number, 0, 12).getDate()
  const cells: (string | null)[] = Array(offset).fill(null)
  for (let day = 1; day <= count; day++) cells.push(`${month}-${String(day).padStart(2, '0')}`)
  while (cells.length % 7) cells.push(null)
  return cells
}
