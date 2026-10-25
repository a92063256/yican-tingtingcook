import type { Recipe, State } from './domain'

// Fixed random seed keeps test IDs and ordering stable across refreshes.
export function generateTestRecipes(): Recipe[] {
  let seed = 91750
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 }
  const ingredients = ['鸡腿肉','杏鲍菇','土豆','南瓜','茄子','藕片','花菜','胡萝卜','香菇','冬瓜']
  const methods = [
    ['蒜香','家常小炒','greens'], ['红烧','风味好菜','beef'], ['香煎','煎烤小食','tofu'],
    ['清炖','暖心汤羹','soup'], ['椒盐','下饭好菜','shrimp']
  ]
  const list: Recipe[] = methods.flatMap(([method, category, art], group) => ingredients.map((ingredient, index) => ({
    id: `demo-extra-${group * ingredients.length + index + 1}`,
    name: `${method}${ingredient}`, category, art,
    minutes: 10 + Math.floor(random() * 7) * 5, servings: 2,
    note: '测试菜 · 封面复用',
    ingredients: [{name:ingredient, amount:200 + Math.floor(random()*5)*50,unit:'克',type:'food'}, {name:'盐',amount:2,unit:'克',type:'seasoning'}, {name:'食用油',amount:10,unit:'毫升',type:'seasoning'}],
    steps: ['这是一道自动生成的交互测试菜，用于测试选菜、购物车和食材合并。','封面复用现有插画；食材、用量与时长为测试数据，不作为实际烹饪参考。']
  })))
  for (let i=list.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [list[i],list[j]]=[list[j],list[i]] }
  return list
}

export function ensureTestMenu(state: State) {
  if (state.testMenuVersion === 1) return
  const extra = generateTestRecipes()
  for (const recipe of extra) if (!state.recipes.some(r=>r.id===recipe.id)) state.recipes.push(recipe)
  for (const kitchen of state.kitchens.filter(k=>['home','friends'].includes(k.id))) {
    kitchen.recipeIds = [...new Set([...kitchen.recipeIds, ...extra.map(r=>r.id)])]
  }
  state.testMenuVersion = 1
}
