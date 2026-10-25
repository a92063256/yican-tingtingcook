import { configDefaults, defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
// Preserve the browser's Host so the API can enforce same-origin writes through Vite.
const proxy={'/api':{target:'http://127.0.0.1:3000',changeOrigin:false}}
export default defineConfig({plugins:[vue()],base:'./',test:{exclude:[...configDefaults.exclude,'**/build/**','**/release/**']},server:{host:'127.0.0.1',proxy,watch:{ignored:['**/build/**','**/release/**']}},preview:{host:'127.0.0.1',proxy}})
