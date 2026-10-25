import { describe, expect, it } from 'vitest'
import { createSeed } from './seed'
import { dateOrderMark, emptyMarks, favoriteKey, migrateRecipeMarks, monthCells, toggleMark } from './preferences'

describe('calendar and recipe preferences', () => {
  it('aligns Monday-first months and includes leap day', () => {
    const cells = monthCells('2024-02')
    expect(cells.slice(0, 4)).toEqual([null, null, null, '2024-02-01'])
    expect(cells.filter(Boolean)).toHaveLength(29)
    expect(cells.length % 7).toBe(0)
    expect(monthCells('2026-02').filter(Boolean)).toHaveLength(28)
  })
  it('isolates favorites by user and kitchen and toggles off', () => {
    const marks = emptyMarks()
    toggleMark(marks.favorites, favoriteKey('home', 'lin'), 'tomato')
    expect(marks.favorites['home:chen']).toBeUndefined()
    expect(marks.favorites['friends:lin']).toBeUndefined()
    toggleMark(marks.favorites, 'home:lin', 'tomato')
    expect(marks.favorites['home:lin']).toEqual([])
  })
  it('keeps marks when a recipe is versioned in one kitchen', () => {
    const marks = { signatures: {home:['tomato']}, favorites:{'home:lin':['tomato'], 'friends:lin':['tomato']} }
    migrateRecipeMarks(marks, 'home', 'tomato', 'private-new')
    expect(marks.signatures.home).toEqual(['private-new'])
    expect(marks.favorites['home:lin']).toEqual(['private-new'])
    expect(marks.favorites['friends:lin']).toEqual(['tomato'])
  })
  it('shows own and other orders only for allowed meals', () => {
    const state = createSeed()
    const mealId = state.orders[0].mealId
    expect(dateOrderMark(state, [mealId], 'lin')).toEqual({mine:true, others:false})
    expect(dateOrderMark(state, [mealId], 'chen')).toEqual({mine:false, others:true})
    expect(dateOrderMark(state, [], 'lin')).toEqual({mine:false, others:false})
    state.orders = []
    expect(dateOrderMark(state, [mealId], 'lin')).toEqual({mine:false, others:false})
  })
})
