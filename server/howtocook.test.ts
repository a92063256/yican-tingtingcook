import { expect, it } from 'vitest'
import { parseRecipe, removeCategories, replaceTestCatalog } from './howtocook'
import { createSeed } from '../src/seed'
import { ensureTestMenu } from '../src/demo-menu'
const raw='# 炒土豆的做法\n## 必备原料和工具\n- 土豆\n- 盐\n- 食用油\n- 菜刀\n## 计算\n- 土豆 240g\n- 盐 2g\n- 食用油 10-15ml\n## 操作\n1. 土豆切丝。\n2. 炒熟。\n## 附加内容\n注意控火。'
it('imports exact quantities, preserves original context and leaves ranges unknown',()=>{
 const r=parseRecipe('dishes/vegetable_dish/炒土豆.md',raw)!
 expect(r.ingredients).toEqual([{name:'土豆',amount:240,unit:'克',type:'food'},{name:'盐',amount:2,unit:'克',type:'seasoning'},{name:'食用油',amount:null,unit:'份',type:'seasoning'}])
 expect(r.steps).toEqual(['土豆切丝。','炒熟。']);expect(r.sourceText).toBe(raw)
 expect(parseRecipe('dishes/template/模板.md',raw)).toBeNull()
 expect(parseRecipe('dishes/soup/目录.md','# 目录')).toBeNull()
 expect(r.id).toBe(parseRecipe('dishes/vegetable_dish/炒土豆.md',raw)!.id)
})
it('retires test menus without erasing orders, stock or private recipes, and is idempotent',()=>{
 const s=createSeed();ensureTestMenu(s);const r=parseRecipe('dishes/vegetable_dish/炒土豆.md',raw)!
 const personal={...r,id:'private-user',name:'示例炒鸡',steps:[]};s.recipes.push(personal);s.kitchens[0].recipeIds.push(personal.id)
 s.recipeMarks={signatures:{home:[personal.id,'demo-extra-1']},favorites:{}}
 const orders=structuredClone(s.orders),stock=structuredClone(s.stock)
 replaceTestCatalog(s,[r]);const once=JSON.stringify(s);replaceTestCatalog(s,[r]);expect(JSON.stringify(s)).toBe(once)
 expect(s.orders).toEqual(orders);expect(s.stock).toEqual(stock)
 expect(s.recipes).toContainEqual(personal);expect(s.recipeMarks.signatures.home).toEqual([personal.id])
 expect(s.kitchens[0].recipeIds).toEqual([personal.id,r.id])
 for(const id of orders.flatMap(o=>o.recipeIds))expect(s.recipes.find(r=>r.id===id)?.archived).toBe(true)
})

it('keeps calculation-only ingredients with ranges in the shopping candidates',()=>{
 const r=parseRecipe('dishes/vegetable_dish/测试.md',raw.replace('- 食用油\n',''))!
 expect(r.ingredients.find(i=>i.name==='食用油')?.amount).toBeNull()
})
it('removes excluded categories and preserves only historical recipe references',()=>{
 const s=createSeed(), condiment={...parseRecipe('dishes/vegetable_dish/炒土豆.md',raw)!,id:'condiment',category:'酱料调味'},kept={...parseRecipe('dishes/vegetable_dish/炒土豆.md',raw)!,id:'finished',category:'半成品'}
 s.recipes.push(condiment,kept);s.kitchens[0].recipeIds.push(condiment.id,kept.id);s.orders.push({id:'old',userId:'lin',mealId:s.meals[0].id,recipeIds:[kept.id],note:'',createdAt:'2026-01-01T00:00:00Z'})
 const result=removeCategories(s,['酱料调味','半成品'])
 expect(result).toEqual({removed:1,archived:1});expect(s.recipes.some(r=>r.id==='condiment')).toBe(false)
 expect(s.recipes.find(r=>r.id==='finished')?.archived).toBe(true);expect(s.kitchens[0].recipeIds).not.toContain('finished')
})
