export interface Theme {
  id: string
  name: string
  description: string
  source: string
  colors: { paper: string; white: string; ink: string; muted: string; line: string; accent: string; hover: string; soft: string; tint: string; companion: string }
}

// Adapted for light surfaces and legible white button text; source palettes are documented in docs/主题与用餐日志.md.
export const themes: Theme[] = [
  { id:'apricot', name:'杏檐暖照', description:'陶土橙与奶油白，盛一碗日常的暖意', source:'https://www.happyhues.co/palettes/11', colors:{paper:'#faf6f0',white:'#fffdfa',ink:'#302d2a',muted:'#726b65',line:'#e9dfd4',accent:'#b94d17',hover:'#983b0d',soft:'#fff0e2',tint:'#f2e6d8',companion:'#e8bc8a'} },
  { id:'pine', name:'松风煮雪', description:'松针绿与薄荷灰，山间清风落在餐桌', source:'https://www.happyhues.co/palettes/10', colors:{paper:'#f3f7f3',white:'#fcfefa',ink:'#203c35',muted:'#5e7169',line:'#dce6dd',accent:'#316653',hover:'#214c3e',soft:'#e5f0e5',tint:'#dce8de',companion:'#d7bb7e'} },
  { id:'tide', name:'雾海听潮', description:'雾蓝与浅沙，像海边慢下来的午后', source:'https://www.happyhues.co/palettes/14', colors:{paper:'#f2f7f8',white:'#fcfefe',ink:'#243b49',muted:'#5e727c',line:'#dce7eb',accent:'#326b81',hover:'#245166',soft:'#e2eff2',tint:'#dce9ed',companion:'#e6ca85'} },
  { id:'violet', name:'暮山烟紫', description:'烟紫与月白，把暮色温柔留住', source:'https://www.happyhues.co/palettes/6', colors:{paper:'#f7f5fa',white:'#fefcff',ink:'#393249',muted:'#736a80',line:'#e5dfed',accent:'#72519c',hover:'#58397e',soft:'#eee7f5',tint:'#e6ddef',companion:'#c8bddf'} },
  { id:'rose', name:'玫庭晚照', description:'干枯玫瑰与柔粉，一餐也有小小浪漫', source:'https://www.happyhues.co/palettes/12', colors:{paper:'#faf4f4',white:'#fffdfc',ink:'#473239',muted:'#7e6970',line:'#eddee1',accent:'#a44762',hover:'#85344b',soft:'#f8e6eb',tint:'#efdee4',companion:'#b8c1df'} },
]
export const themeStorageKey = new URLSearchParams(location.search).has('qa') ? 'yican-theme-qa' : 'yican-theme'
export function findTheme(id: string | null) { return themes.find(t => t.id === id) ?? themes[0] }
export function readTheme() {
  try { return findTheme(localStorage.getItem(themeStorageKey)) } catch { return themes[0] }
}
export function applyTheme(theme: Theme) {
  const root = document.documentElement
  root.dataset.theme = theme.id
  for (const [key, value] of Object.entries(theme.colors)) root.style.setProperty('--theme-' + key, value)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.colors.paper)
}
