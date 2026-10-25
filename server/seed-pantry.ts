import { randomUUID } from 'node:crypto'
import { Store } from './store'
import type { Ingredient, Stock } from '../src/domain'

const kitchenId = process.env.YICAN_KITCHEN_ID || 'home'
const store = new Store(`${process.env.YICAN_DATA_DIR || 'data'}/kitchen.sqlite`)

type PantryItem = Omit<Ingredient, 'amount'> & { amount: number | null }

// These are the canonical, reusable seasonings that occur most often in the imported menu.
// Quantities remain null until the user confirms what is physically available.
const commonSeasonings: PantryItem[] = [
  '料酒', '白糖', '淀粉', '鸡精', '蚝油', '花椒', '八角', '桂皮', '香叶', '干辣椒',
  '胡椒粉', '白胡椒粉', '香油', '醋', '豆瓣酱', '冰糖', '味精', '孜然粉', '五香粉',
  '老抽', '海鲜酱', '白芷', '青花椒', '红花椒', '毛砂仁'
].map(name => ({ name, amount: null, unit: name === '香油' ? '毫升' : '克', type: 'seasoning' as const }))

// The recipe gives quantities for the first five ingredients and for the sauces/oil below.
// “几粒” and “适量” intentionally stay unknown in stock until confirmed by the user.
const linyiChicken: PantryItem[] = [
  { name: '公鸡', amount: 3, unit: '斤', type: 'food' },
  { name: '大葱', amount: 1, unit: '根', type: 'food' },
  { name: '大蒜', amount: null, unit: '粒', type: 'food' },
  { name: '姜', amount: 60, unit: '克', type: 'food' },
  { name: '螺丝椒', amount: 120, unit: '克', type: 'food' },
  { name: '八角', amount: null, unit: '克', type: 'seasoning' },
  { name: '白芷', amount: null, unit: '克', type: 'seasoning' },
  { name: '青花椒', amount: null, unit: '克', type: 'seasoning' },
  { name: '红花椒', amount: null, unit: '克', type: 'seasoning' },
  { name: '香叶', amount: null, unit: '克', type: 'seasoning' },
  { name: '毛砂仁', amount: null, unit: '克', type: 'seasoning' },
  { name: '干辣椒', amount: null, unit: '克', type: 'seasoning' },
  { name: '生抽', amount: 10, unit: '克', type: 'seasoning' },
  { name: '老抽', amount: 10, unit: '克', type: 'seasoning' },
  { name: '蚝油', amount: 20, unit: '克', type: 'seasoning' },
  { name: '海鲜酱', amount: 40, unit: '克', type: 'seasoning' },
  { name: '食用油', amount: null, unit: '克', type: 'seasoning' }
]

function key(item: Pick<Ingredient, 'name' | 'unit'>) { return `${item.name}|${item.unit}` }

try {
  const initial = store.snapshot().state
  const kitchen = initial.kitchens.find(item => item.id === kitchenId)
  if (!kitchen) throw new Error(`厨房不存在：${kitchenId}`)

  // Recipe quantities win over the generic seasoning seed, while existing rows always win
  // over both. This keeps a user's manually entered stock untouched.
  const desired = new Map<string, PantryItem>()
  for (const item of commonSeasonings) desired.set(key(item), item)
  for (const item of linyiChicken) desired.set(key(item), item)
  const existing = new Set(initial.stock.filter(item => item.kitchenId === kitchenId).map(key))
  const pending = [...desired.values()].filter(item => !existing.has(key(item)))

  if (!pending.length) {
    console.log(JSON.stringify({ kitchen: kitchen.name, added: [], unchanged: true }, null, 2))
  } else {
    const result = store.update(state => {
      const added: Stock[] = []
      for (const item of pending) {
        const row = { ...item, id: randomUUID(), kitchenId } satisfies Stock
        state.stock.push(row)
        added.push(row)
      }
      return { kitchen: kitchen.name, added }
    })
    console.log(JSON.stringify({
      kitchen: result.kitchen,
      added: result.added.map(({ id, kitchenId: _, ...item }) => item),
      addedCount: result.added.length,
      unknownCount: result.added.filter(item => item.amount === null).length
    }, null, 2))
  }
} finally {
  store.close()
}
