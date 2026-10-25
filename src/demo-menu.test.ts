import { expect, it } from 'vitest'
import { createSeed } from './seed'
import { ensureTestMenu, generateTestRecipes } from './demo-menu'

it('generates 50 unique stable test dishes reusing existing artwork',()=>{
  const list=generateTestRecipes()
  expect(list).toHaveLength(50)
  expect(new Set(list.map(r=>r.id)).size).toBe(50)
  expect(new Set(list.map(r=>r.name)).size).toBe(50)
  expect(list).toEqual(generateTestRecipes())
  expect(list.every(r=>['tomato','beef','shrimp','soup','greens','tofu'].includes(r.art))).toBe(true)
})
it('adds the test menu once without replacing user orders or edited recipes',()=>{
  const state=createSeed()
  const oldOrders=structuredClone(state.orders)
  state.recipes.find(r=>r.id==='tomato')!.name='我家的番茄炒蛋'
  ensureTestMenu(state)
  ensureTestMenu(state)
  expect(state.recipes).toHaveLength(56)
  expect(state.kitchens.find(k=>k.id==='home')!.recipeIds).toHaveLength(56)
  expect(state.orders).toEqual(oldOrders)
  expect(state.recipes.find(r=>r.id==='tomato')!.name).toBe('我家的番茄炒蛋')
  state.kitchens[0].recipeIds=state.kitchens[0].recipeIds.filter(id=>id!=='demo-extra-1')
  ensureTestMenu(state)
  expect(state.kitchens[0].recipeIds).not.toContain('demo-extra-1')
})
