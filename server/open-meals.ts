import { Store } from './store'
import { dateKey } from '../src/domain'

const kitchenId = process.env.YICAN_KITCHEN_ID || 'home'
const days = Math.max(1, Math.min(30, Number(process.env.YICAN_OPEN_DAYS || 7)))
const store = new Store(`${process.env.YICAN_DATA_DIR || 'data'}/kitchen.sqlite`)

try {
  const planned = (state: ReturnType<Store['snapshot']>['state']) => {
    const kitchen = state.kitchens.find(k => k.id === kitchenId)
    if (!kitchen) throw new Error(`厨房不存在：${kitchenId}`)
    if (!kitchen.chefId) throw new Error(`厨房没有主厨，不能开放餐次：${kitchen.name}`)
    const today = new Date()
    today.setHours(12, 0, 0, 0)
    const rows: { date: string; suffix: string; name: string; start: string; end: string; deadline: string }[] = []
    for (let offset = 1; offset <= days; offset++) {
      const day = new Date(today)
      day.setDate(day.getDate() + offset)
      const date = dateKey(day)
      rows.push(
        { date, suffix: 'lunch', name: '午餐', start: '12:00', end: '14:00', deadline: '11:00' },
        { date, suffix: 'dinner', name: '晚餐', start: '18:30', end: '21:00', deadline: '17:30' }
      )
    }
    return { kitchen, rows }
  }
  const initial = store.snapshot().state
  const { kitchen, rows } = planned(initial)
  const missing = rows.filter(row => !initial.meals.some(m => m.kitchenId === kitchen.id && m.date === row.date && m.name === row.name))
  if (!missing.length) {
    console.log(JSON.stringify({ kitchen: kitchen.name, days, added: [], existing: rows.map(row => `${row.date} · ${row.name}`), unchanged: true }, null, 2))
    process.exitCode = 0
  } else {
    const result = store.update(state => {
      const target = state.kitchens.find(k => k.id === kitchenId)!
      const added: string[] = []
      for (const plan of missing) {
        state.meals.push({
          id: `rolling-${target.id}-${plan.date}-${plan.suffix}`,
          kitchenId: target.id,
          date: plan.date,
          name: plan.name,
          startsAt: `${plan.date}T${plan.start}:00`,
          endsAt: `${plan.date}T${plan.end}:00`,
          deadline: `${plan.date}T${plan.deadline}:00`,
          status: 'open',
          portions: {}
        })
        added.push(`${plan.date} · ${plan.name}`)
      }
      return { kitchen: target.name, days, added, existing: rows.filter(row => !missing.includes(row)).map(row => `${row.date} · ${row.name}`) }
    })
    console.log(JSON.stringify(result, null, 2))
  }
} finally {
  store.close()
}
