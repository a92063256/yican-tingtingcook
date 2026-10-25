import type { Ingredient } from './domain'

// Extend units and seasoning vocabulary here; parsing never guesses package weight or expiry.
export const stockUnits = ['份','克','千克','斤','两','个','瓶','罐','袋','包','盒','把','根','颗','粒','块','片','条','只','棵','捆','桶','毫升','升','勺']
const unitAliases: Record<string,string> = {公斤:'千克',市斤:'斤',市两:'两',kg:'千克',g:'克',ml:'毫升',l:'升',公升:'升',公克:'克',两:'两',枚:'个',個:'个',顆:'颗',隻:'只',條:'条',塊:'块'}
const unitPattern = [...stockUnits,...Object.keys(unitAliases)].sort((a,b)=>b.length-a.length).join('|')
const numberPattern = '(?:[0-9]+(?:\\.[0-9]+)?|[零〇一二两俩仨三四五六七八九十百千万点]+|半)'
const quantityPattern = `${numberPattern}\\s*(?:${unitPattern})?(?:半)?`
const quantityOnly = new RegExp(`^${quantityPattern}$`,'i')
const suffix = new RegExp(`^(.+?)\\s*(${numberPattern})\\s*(${unitPattern})(半)?$`,'i')
const bareSuffix = new RegExp(`^(.+?)\\s*(${numberPattern})$`,'i')
const prefix = new RegExp(`^(${numberPattern})\\s*(${unitPattern})(半)?\\s*(.+)$`,'i')
const digits:Record<string,number> = {零:0,〇:0,一:1,二:2,两:2,俩:2,仨:3,三:3,四:4,五:5,六:6,七:7,八:8,九:9}
const numberedNames = ['八角','十三香','五香粉','三文鱼','四季豆','五花肉','九层塔','七星椒','千张','百叶','二荆条','八宝粥','一品鲜酱油','六必居甜面酱']
const seasonings = ['酱油','生抽','老抽','味极鲜','蚝油','鱼露','料酒','黄酒','白醋','陈醋','米醋','香醋','醋','盐','食盐','海盐','白糖','白砂糖','冰糖','红糖','味精','鸡精','鸡粉','胡椒粉','白胡椒','黑胡椒','白胡椒粉','黑胡椒粉','花椒','花椒粉','花椒油','辣椒粉','辣椒油','干辣椒','辣椒干','干红辣椒','干红椒','干辣椒段','辣椒面','孜然','孜然粉','五香粉','十三香','八角','桂皮','香叶','小茴香','食用油','花生油','大豆油','菜籽油','玉米油','橄榄油','芝麻油','香油','豆瓣酱','甜面酱','黄豆酱','番茄酱','沙拉酱','辣椒酱','芝麻酱','花生酱','蒜蓉酱','海鲜酱','柱候酱','豆豉','淀粉','玉米淀粉','生粉','酵母','泡打粉','蜂蜜','咖喱粉','咖喱块','火锅底料']
export function stockTypeForName(name:string):Ingredient['type'] {
  return seasonings.some(word=>name===word||name.endsWith(word))?'seasoning':'food'
}
function numberValue(raw:string):number {
  if(raw==='半')return .5
  if(/^\d/.test(raw))return Number(raw)
  const [integer,decimal] = raw.split('点')
  if(!integer||raw.split('点').length>2)return NaN
  let value=0,section=0,digit=0,lastScale=Infinity
  if(!/[十百千万]/.test(integer)){if(integer.length!==1)return NaN;value=digits[integer]??NaN}
  else for(const char of integer){
    if(char in digits){digit=digits[char];continue}
    const scale=({十:10,百:100,千:1000,万:10000} as Record<string,number>)[char]
    if(!scale)return NaN
    if(scale===10000){value+=(section+digit)*scale;section=0;digit=0;lastScale=Infinity}
    else {if(scale>=lastScale)return NaN;section+=(digit||1)*scale;digit=0;lastScale=scale}
  }
  if(/[十百千万]/.test(integer))value+=section+digit
  if(decimal!==undefined){if(!decimal||[...decimal].some(c=>!(c in digits)))return NaN;value+=Number('0.'+[...decimal].map(c=>digits[c]).join(''))}
  return value
}
// Treat spaces as boundaries only when both sides contain complete, explicit entries.
// Ambiguous text such as “一袋牛奶250ml” must still be corrected by the user.
function validName(name:string,explicit:boolean):boolean {
  return !!name&&name.length<=80&&!/[\d\s+\-~～/()[\]{}:：=×*|•·・]/.test(name)
    &&!quantityOnly.test(name)&&!new RegExp(`^(?:${unitPattern})$`,'i').test(name)
    &&!new RegExp(`${numberPattern}\\s*(?:${unitPattern})`,'i').test(name)
    &&!(explicit&&(/[零〇一二两俩仨三四五六七八九十百千万点半]$/.test(name)||new RegExp(`(?:${unitPattern})$`,'i').test(name)))
}
function explicitEntry(text:string):boolean {
  const end=text.match(suffix),start=text.match(prefix)
  return validName((end?.[1]??start?.[4]??'').trim(),true)
}
function splitSpacedEntries(text:string):string[] {
  if(explicitEntry(text))return [text]
  for(const match of text.matchAll(/\s+/g)){
    const left=text.slice(0,match.index),right=text.slice(match.index!+match[0].length)
    if(!explicitEntry(left))continue
    const rest=splitSpacedEntries(right)
    if(rest.every(explicitEntry))return [left,...rest]
  }
  return [text]
}
function entryText(text:string):string {
  return text.trim().replace(/^[“”‘’"']+|[“”‘’"']+$/g,'')
    .replace(new RegExp(`\\s*(?:[:：=×*]|[xX])\\s*(?=${numberPattern})`,'g'),' ')
    .replace(new RegExp(`\\(\\s*(${quantityPattern})\\s*\\)$`,'i'),' $1').trim()
}
export interface StockTextRow { raw:string; value:Ingredient; defaulted:boolean }
export interface StockTextIssue { raw:string; message:string }
export function parseStockText(input:string):{rows:StockTextRow[];issues:StockTextIssue[]} {
  const rows:StockTextRow[]=[],issues:StockTextIssue[]=[]
  if(input.length>10000)return {rows,issues:[{raw:'',message:'一次最多输入 10000 字，请分批录入。'}]}
  const normalized=input.normalize('NFKC')
    .replace(/^\s*(?:\d+(?:[.)]\s+|、\s*)|[-*•]\s+)/gm,'')
    .replace(/[…]+|\.{2,}/g,'\n').replace(/(^|[^\d])\.(?=\d)/g,(_,before:string)=>before+'0.')
    .replace(/(?<!\d)\.|\.(?!\d)/g,'\n')
  // Preserve numeric fractions as one invalid entry rather than importing two misleading fragments.
  const chunks=normalized.split(/[，,、。；;！!？?\r\n\t|•·・،؛]+|(?<!\d)\/|\/(?!\d)/)
    .map(entryText).filter(Boolean).flatMap(splitSpacedEntries)
  const entries:string[]=[]
  for(const chunk of chunks){
    // A comma between an ingredient and its amount is not an item boundary: 鸡蛋，10个。
    if(quantityOnly.test(chunk)&&entries.length&&!suffix.test(entries.at(-1)!)&&!bareSuffix.test(entries.at(-1)!)&&!prefix.test(entries.at(-1)!))entries[entries.length-1]+=' '+chunk
    else entries.push(chunk)
  }
  for(const raw of entries){
    if(rows.length>=100){issues.push({raw,message:'一次最多录入 100 项，请分批保存。'});break}
    const text=raw
    if(/保质|到期|有效期|过期|用完|吃完|耗尽|适量|少量|少许|若干|一些|左右|大约|大概|约\d|几|\d\s*[-~～至到]\s*\d|[零一二两三四五六七八九十]+[至到][零一二两三四五六七八九十]+/.test(text)){
      issues.push({raw,message:'请只填写明确的名称、数量和单位；用完状态与日期不会自动推断。'});continue
    }
    let name=text,amount=1,unit='份',defaulted=true
    const end=text.match(suffix)??text.match(bareSuffix),start=text.match(prefix)
    if(end){name=end[1].trim();amount=numberValue(end[2])+(end[4]?0.5:0);unit=unitAliases[end[3]?.toLowerCase()]??end[3]??'份';defaulted=false}
    else if(start){name=start[4].trim();amount=numberValue(start[1])+(start[3]?0.5:0);unit=unitAliases[start[2].toLowerCase()]??start[2];defaulted=false}
    if(!validName(name,!defaulted)){
      issues.push({raw,message:'没能分清名称和数量，请用“芹菜一斤”这样的写法，多项之间可加逗号、顿号、分号、斜杠或换行。'});continue
    }
    // A unit without a number, or an unknown numeric unit, needs clarification rather than a guessed quantity.
    if(defaulted&&(/[零〇一二两俩仨三四五六七八九十百千万点半]/.test(name)&&!numberedNames.some(word=>name.endsWith(word)))){
      issues.push({raw,message:'数量或单位未识别，请改为明确的数字和常用单位。'});continue
    }
    if(!Number.isFinite(amount)||amount<.0001||amount>1e7){issues.push({raw,message:'数量需在 0.0001 到 10000000 之间。'});continue}
    rows.push({raw,value:{name,amount:Math.round(amount*10000)/10000,unit,type:stockTypeForName(name)},defaulted})
  }
  return {rows,issues}
}
