import { expect, it } from 'vitest'
import { createSeed } from './seed'
import { journalMonthSummary, mealJournal } from './journal'
import type { Meal, Order } from './domain'

function fixture() {
  const state=createSeed()
  state.meals=[];state.orders=[];state.reviews=[]
  const add=(id:string,date:string,status:Meal['status']='done',recipeIds=['tomato','soup'])=>{
    const meal:Meal={id,kitchenId:'home',date,name:'晚餐',startsAt:date+'T18:00:00',endsAt:date+'T21:00:00',deadline:date+'T17:00:00',status,portions:{}}
    const order:Order={id:'order-'+id,mealId:id,userId:'lin',recipeIds,note:'少放盐',createdAt:date+'T10:00:00'}
    state.meals.push(meal);state.orders.push(order)
    return {meal,order}
  }
  const now=+new Date('2026-10-15T12:00:00')
  return {state,add,now}
}

it('distinguishes completed meals from elapsed orders and omits future, cancelled and empty meals',()=>{
  const {state,add,now}=fixture()
  add('old','2026-10-12','open');add('done','2026-10-13');add('future','2026-10-16','open')
  add('cancelled','2026-10-11','cancelled');add('empty','2026-10-10','done',[])
  const zero=add('zero','2026-10-09');zero.meal.portions={tomato:0,soup:0}
  expect(mealJournal(state,'home','lin',now).map(e=>[e.meal.id,e.confirmed])).toEqual([['old',false],['done',true]])
})

it('requires permanent membership and isolates kitchens even when another kitchen has orders',()=>{
  const {state,add,now}=fixture();const {meal}=add('home','2026-10-12')
  state.grants.push({userId:'guest',mealId:meal.id})
  const other=add('other','2026-10-13');other.meal.kitchenId='friends'
  expect(mealJournal(state,'home','lin',now)).toHaveLength(1)
  expect(mealJournal(state,'friends','chen',now)).toEqual([])
  expect(mealJournal(state,'home','guest',now)).toEqual([])
  expect(mealJournal(state,'friends','lin',now).map(e=>e.meal.id)).toEqual(['other'])
})

it('counts days once, meals separately and shared dishes once per meal across month boundaries',()=>{
  const {state,add,now}=fixture()
  const a=add('dinner','2026-09-30');a.meal.startsAt='2026-09-30T18:00:00'
  const b=add('lunch','2026-09-30');b.meal.startsAt='2026-09-30T12:00:00'
  add('october','2026-10-01')
  state.orders.push({...a.order,id:'second-diner',userId:'chen',recipeIds:['tomato']})
  const entries=mealJournal(state,'home','lin',now)
  expect(entries.map(e=>e.meal.id)).toEqual(['lunch','dinner','october'])
  expect(journalMonthSummary(entries,'2026-09')).toEqual({days:1,meals:2,dishes:4})
  expect(journalMonthSummary(entries,'2026-10')).toEqual({days:1,meals:1,dishes:2})
  expect(journalMonthSummary(entries,'2026-08')).toEqual({days:0,meals:0,dishes:0})
})

it('uses archived recipe versions and actual portions, keeps notes and attaches only matching reviews',()=>{
  const {state,add,now}=fixture();const {meal}=add('history','2026-10-12')
  state.recipes[0].archived=true;meal.portions={tomato:2,soup:0}
  state.kitchens[0].recipeIds=['private-new']
  state.recipes.push({...state.recipes[0],id:'private-new',name:'新版番茄炒蛋'})
  const review={id:'review',kitchenId:'home',mealId:meal.id,userId:'chen',recipeId:null,recipeKey:null,text:'很好吃 🍚',createdAt:'2026-10-12T21:00:00',updatedAt:'2026-10-12T21:00:00'}
  state.reviews=[review,{...review,id:'foreign',kitchenId:'friends'},{...review,id:'another-meal',mealId:'other'}]
  const [entry]=mealJournal(state,'home','lin',now)
  expect(entry.dishes.map(d=>[d.recipe?.name,d.portions])).toEqual([['番茄炒蛋',2]])
  expect(entry.orders[0].note).toBe('少放盐')
  expect(entry.reviews).toEqual([review])
})

it('waits for the end of an overnight meal, retains its starting date and does not mutate state',()=>{
  const {state,add}=fixture();const {meal}=add('overnight','2026-09-30','cooking',['missing-recipe'])
  meal.endsAt='2026-10-01T01:00:00'
  const before=JSON.stringify(state)
  expect(mealJournal(state,'home','lin',+new Date('2026-10-01T00:30:00'))).toEqual([])
  const [entry]=mealJournal(state,'home','lin',+new Date(meal.endsAt))
  expect(entry.meal.date).toBe('2026-09-30')
  expect(entry.dishes[0]).toEqual({id:'missing-recipe',recipe:undefined,portions:1})
  expect(JSON.stringify(state)).toBe(before)
})
