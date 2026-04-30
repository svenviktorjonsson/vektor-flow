import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import DemoPair from './components/DemoPair.vue'
import CuratedPlayground from './components/CuratedPlayground.vue'
import './custom.css'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('DemoPair', DemoPair)
    app.component('CuratedPlayground', CuratedPlayground)
  }
}

export default theme