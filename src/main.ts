import { createApp } from 'vue'
import App from './AccountRoot.vue'
import './style.css'
import { applyTheme, readTheme } from './themes'
applyTheme(readTheme())
createApp(App).mount('#app')

import './mobile-warm.css'
import './reviews.css'

import './themes.css'
import './journal.css'
import './account.css'
