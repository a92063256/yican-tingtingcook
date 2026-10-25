import { dateKey, type Ingredient, type Recipe, type State } from './domain'
const food = (name: string, amount: number | null, unit = '克'): Ingredient => ({ name, amount, unit, type: 'food' })
const spice = (name: string, amount: number | null, unit = '毫升'): Ingredient => ({ name, amount, unit, type: 'seasoning' })
export const recipes: Recipe[] = [
  { id: 'tomato', name: '番茄炒蛋', category: '家常小炒', minutes: 15, servings: 2, note: '酸甜刚刚好，拌饭也很香', art: 'tomato', ingredients: [food('番茄', 300), food('鸡蛋', 3, '个'), spice('食用油', 15), spice('盐', 2, '克')], steps: ['番茄洗净切块，鸡蛋打散。','锅中加油，倒入蛋液炒至凝固后盛出。','炒软番茄，放回鸡蛋，加盐翻炒均匀。'], source: '' },
  { id: 'beef', name: '西兰花炒牛肉', category: '家常小炒', minutes: 25, servings: 2, note: '鲜嫩牛肉，配一口清脆', art: 'beef', ingredients: [food('牛肉', 250), food('西兰花', 200), food('蒜', 10), spice('生抽', 15), spice('食用油', 15)], steps: ['牛肉切片，用生抽腌制；西兰花洗净分小朵。','西兰花焯水后沥干，蒜切末。','热锅炒熟牛肉，加入西兰花和蒜末炒匀。'] },
  { id: 'shrimp', name: '蒜香黄油虾', category: '风味好菜', minutes: 20, servings: 2, note: '周末的仪式感，也可以很简单', art: 'shrimp', ingredients: [food('鲜虾', 300), food('蒜', 15), food('黄油', 20), spice('盐', 2, '克')], steps: ['鲜虾去虾线，清洗后擦干；蒜切末。','锅中融化黄油，放入虾煎至变色。','加入蒜末与盐，继续翻炒至虾完全熟透。'] },
  { id: 'soup', name: '番茄豆腐汤', category: '暖心汤羹', minutes: 20, servings: 2, note: '一碗热汤，接住忙碌的一天', art: 'soup', ingredients: [food('番茄', 200), food('豆腐', 200), food('小葱', 5), spice('盐', 2, '克'), spice('食用油', 5)], steps: ['番茄切块、豆腐切小块，小葱切段。','锅中加油炒软番茄，加水煮开。','加入豆腐煮透，放盐，出锅前撒葱花。'] },
  { id: 'greens', name: '蒜蓉青菜', category: '清爽时蔬', minutes: 10, servings: 2, note: '清清爽爽，给餐桌添点绿', art: 'greens', ingredients: [food('青菜', 300), food('蒜', 10), spice('食用油', 10), spice('盐', 2, '克')], steps: ['青菜洗净沥水，蒜切末。','热锅加油，放蒜末炒香。','加入青菜翻炒至熟，加盐调味。'] },
  { id: 'tofu', name: '香煎豆腐', category: '煎烤小食', minutes: 20, servings: 2, note: '外面微微脆，里面软乎乎', art: 'tofu', ingredients: [food('豆腐', 300), food('小葱', 5), spice('生抽', 10), spice('食用油', 15)], steps: ['豆腐切厚片，轻轻吸干表面水分。','平底锅加油，将豆腐两面煎至金黄。','淋上生抽，撒小葱，继续加热至入味。'] }
]
export function createSeed(): State {
  const base = new Date(); base.setHours(12, 0, 0, 0)
  const dates = Array.from({ length: 7 }, (_, i) => { const d = new Date(base); d.setDate(d.getDate() + i); return dateKey(d) })
  const meals = dates.flatMap((date, i) => ['午餐', '晚餐'].map((name, j) => ({ id: `home-${i}-${j}`, kitchenId: 'home', date, name, startsAt: `${date}T${j ? '18:30' : '12:00'}:00`, endsAt: `${date}T${j ? '21:00' : '14:00'}:00`, deadline: `${date}T${j ? '17:30' : '11:00'}:00`, status: 'open' as const, portions: {} })))
  meals.push({ id: 'friends-meal', kitchenId: 'friends', date: dates[2], name: '周末聚餐', startsAt: `${dates[2]}T18:00:00`, endsAt: `${dates[2]}T22:00:00`, deadline: `${dates[2]}T16:00:00`, status: 'open', portions: {} })
  return {
    version: 1,
    kitchens: [
      { id: 'home', name: '示例小厨', subtitle: '一屋两人，三餐四季。', chefId: 'chen', ownerId: 'chen', chefLabel: '主厨', dinerLabel: '食客', recipeIds: recipes.map(r => r.id) },
      { id: 'friends', name: '周末饭局', subtitle: '好朋友的相聚，从这一餐开始。', chefId: 'lin', ownerId: 'lin', chefLabel: '掌勺人', dinerLabel: '饭搭子', recipeIds: ['tomato', 'shrimp', 'tofu', 'greens'] }
    ],
    members: [{ userId: 'lin', kitchenId: 'home', role: 'diner' }, { userId: 'chen', kitchenId: 'home', role: 'chef' }, { userId: 'lin', kitchenId: 'friends', role: 'chef' }],
    grants: [], recipes: structuredClone(recipes), meals,
    orders: [{ id: 'seed-order', userId: 'lin', mealId: 'home-1-1', recipeIds: ['tomato', 'soup'], note: '番茄炒蛋想要多一点汁，可以拌饭。', createdAt: new Date().toISOString() }],
    stock: [
      { ...food('番茄', 200), id: 's1', kitchenId: 'home' }, { ...food('鸡蛋', 5, '个'), id: 's2', kitchenId: 'home' },
      { ...food('蒜', 40), id: 's3', kitchenId: 'home' }, { ...food('小葱', null), id: 's4', kitchenId: 'home' },
      { ...spice('盐', 100, '克'), id: 's5', kitchenId: 'home' }, { ...spice('食用油', 300), id: 's6', kitchenId: 'home' },
      { ...spice('生抽', 120), id: 's7', kitchenId: 'home' }
    ], invites: [], checked: {}, feedback: [], reviews: []
  }
}
