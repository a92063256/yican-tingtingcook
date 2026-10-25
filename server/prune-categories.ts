import { resolve } from 'node:path'
import { Store } from './store'
import { removeCategories } from './howtocook'

const categories=['酱料调味','半成品']
const store=new Store(resolve(process.env.YICAN_DATA_DIR||'data','kitchen.sqlite'))
try{console.log(JSON.stringify({...store.update(state=>removeCategories(state,categories)),categories}))}finally{store.close()}
