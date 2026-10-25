import { describe, expect, it } from 'vitest'
import { parseStockText, stockTypeForName } from './stock-text'
import { createSeed } from './seed'
import { shoppingList } from './domain'

describe('文字库存录入',()=>{
  it('parses the reported Chinese comma input as three independent items',()=>{
    const {rows,issues}=parseStockText('干辣椒 一斤，番茄 三个，五花肉两份')
    expect(issues).toEqual([])
    expect(rows.map(r=>[r.value.name,r.value.amount,r.value.unit])).toEqual([
      ['干辣椒',1,'斤'],['番茄',3,'个'],['五花肉',2,'份']
    ])
  })
  it.each(['，',',','、','；',';','。','\n','\t','／','/','｜','|','•','·','・','﹐','､','،','؛'])('accepts the item separator %j',separator=>{
    const {rows,issues}=parseStockText(['干辣椒 一斤','番茄 三个','五花肉两份'].join(separator))
    expect(issues).toEqual([])
    expect(rows.map(r=>r.value.name)).toEqual(['干辣椒','番茄','五花肉'])
  })
  it('accepts labels, multiplication signs, quantity brackets, list markers and common unit aliases',()=>{
    const {rows,issues}=parseStockText('1. 干辣椒：一市斤\n2、番茄（三個）\n- 五花肉×2份\n* 鸡蛋 x 6枚；牛奶=250mL；土豆俩个；胡萝卜仨根')
    expect(issues).toEqual([])
    expect(rows.map(r=>[r.value.name,r.value.amount,r.value.unit])).toEqual([
      ['干辣椒',1,'斤'],['番茄',3,'个'],['五花肉',2,'份'],['鸡蛋',6,'个'],['牛奶',250,'毫升'],['土豆',2,'个'],['胡萝卜',3,'根']
    ])
  })
  it('splits whitespace only between complete entries with explicit units',()=>{
    const {rows,issues}=parseStockText('干辣椒 一斤 番茄 三个 五花肉两份；半斤芹菜；一斤半猪肉')
    expect(issues).toEqual([])
    expect(rows.map(r=>[r.value.name,r.value.amount,r.value.unit])).toEqual([
      ['干辣椒',1,'斤'],['番茄',3,'个'],['五花肉',2,'份'],['芹菜',.5,'斤'],['猪肉',1.5,'斤']
    ])
    expect(parseStockText('芹菜一斤 猪肉二斤').rows).toHaveLength(2)
    expect(parseStockText('1.5kg牛肉').rows[0]?.value).toMatchObject({name:'牛肉',amount:1.5,unit:'千克'})
  })
  it('accepts quoted pasted text and keeps unclear fractions or adjacent quantities out of inventory',()=>{
    expect(parseStockText('“干辣椒 一斤，番茄 三个，五花肉两份”').issues).toEqual([])
    for(const input of ['猪肉1/2斤','鸡蛋10个牛奶2瓶','一袋牛奶250ml','猪肉-2斤']) {
      const result=parseStockText(input)
      expect(result.rows,input).toEqual([])
      expect(result.issues.length,input).toBeGreaterThan(0)
    }
  })
  it('parses the mixed punctuation example without losing the separated egg count',()=>{
    const result=parseStockText('芹菜一斤，酱油一瓶、猪肉罐头 2份。鸡蛋，10个。香菇……')
    expect(result.issues).toEqual([])
    expect(result.rows.map(r=>r.value)).toEqual([
      {name:'芹菜',amount:1,unit:'斤',type:'food'},
      {name:'酱油',amount:1,unit:'瓶',type:'seasoning'},
      {name:'猪肉罐头',amount:2,unit:'份',type:'food'},
      {name:'鸡蛋',amount:10,unit:'个',type:'food'},
      {name:'香菇',amount:1,unit:'份',type:'food'}
    ])
    expect(result.rows.at(-1)?.defaulted).toBe(true)
  })
  it('handles Chinese quantities, half units, decimals, full-width digits and common unit aliases',()=>{
    const {rows,issues}=parseStockText('土豆两斤半；半斤芹菜\n鸡蛋十二个,大米１.５公斤、牛奶 250 ML，牛肉.5kg，花生一百零二克，盐二点五克，猪肉二两')
    expect(issues).toEqual([])
    expect(rows.map(r=>[r.value.name,r.value.amount,r.value.unit])).toEqual([
      ['土豆',2.5,'斤'],['芹菜',.5,'斤'],['鸡蛋',12,'个'],['大米',1.5,'千克'],['牛奶',250,'毫升'],['牛肉',.5,'千克'],['花生',102,'克'],['盐',2.5,'克'],['猪肉',2,'两']
    ])
  })
  it('defaults names to one portion without confusing numbers in ingredient names',()=>{
    const {rows,issues}=parseStockText('八角、十三香、三文鱼、四季豆、五花肉，牛肉2')
    expect(issues).toEqual([])
    expect(rows.map(r=>[r.value.name,r.value.amount,r.value.unit])).toEqual([
      ['八角',1,'份'],['十三香',1,'份'],['三文鱼',1,'份'],['四季豆',1,'份'],['五花肉',1,'份'],['牛肉',2,'份']
    ])
  })
  it('classifies dictionary seasonings and leaves expiry and use-up state unspecified',()=>{
    for(const name of ['海天酱油','生抽','豆瓣酱','食用油','黑胡椒粉','陈醋','八角','干辣椒','辣椒干'])expect(stockTypeForName(name)).toBe('seasoning')
    for(const name of ['猪肉罐头','鸡蛋','芹菜'])expect(stockTypeForName(name)).toBe('food')
    expect(parseStockText('酱油一瓶').rows[0].value).toEqual({name:'酱油',amount:1,unit:'瓶',type:'seasoning'})
  })
  it('reports ambiguous or unsupported text instead of inventing quantities or silently importing fragments',()=>{
    for(const input of ['猪肉2到3斤','土豆两到三斤','盐适量','酱油用完了','鸡蛋保质期7天','猪肉-2斤','胡萝卜2筐','鸡蛋10个牛奶2瓶','一袋牛奶250ml','盐少量','土豆三筐','土豆三四斤','萝卜几根']){
      const result=parseStockText(input)
      expect(result.issues.length,input).toBeGreaterThan(0)
      expect(result.rows,input).toHaveLength(0)
    }
    const result=parseStockText('白菜2斤，盐适量，鸡蛋10个')
    expect(result.rows).toHaveLength(2);expect(result.issues).toHaveLength(1)
    expect(parseStockText('酱油,瓶').issues).toHaveLength(1)
  })
  it('limits batch size and preserves explicit errors for oversized input',()=>{
    expect(parseStockText('菜'.repeat(10001)).issues).toHaveLength(1)
    const result=parseStockText(Array.from({length:101},()=> '白菜一份').join('，'))
    expect(result.rows).toHaveLength(100);expect(result.issues).toHaveLength(1)
  })
  it('matches jin and liang by weight while keeping portions and bottles separate from grams',()=>{
    const s=createSeed(),meal=s.meals.find(m=>m.id==='home-1-1')!
    Object.assign(s.stock.find(x=>x.name==='番茄')!,{amount:1,unit:'斤'})
    expect(shoppingList(s,meal).find(r=>r.name==='番茄')).toMatchObject({available:500,status:'enough'})
    Object.assign(s.stock.find(x=>x.name==='番茄')!,{amount:10,unit:'两'})
    expect(shoppingList(s,meal).find(r=>r.name==='番茄')).toMatchObject({available:500,status:'enough'})
    for(const unit of ['份','瓶']){
      Object.assign(s.stock.find(x=>x.name==='番茄')!,{amount:1,unit})
      expect(shoppingList(s,meal).find(r=>r.name==='番茄')).toMatchObject({available:null,status:'unknown'})
    }
  })
})
