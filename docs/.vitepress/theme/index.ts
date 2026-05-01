import DefaultTheme from 'vitepress/theme'
import type { Theme } from 'vitepress'
import WelcomePage from './components/WelcomePage.vue'
import DemoPair from './components/DemoPair.vue'
import CuratedPlayground from './components/CuratedPlayground.vue'
import './custom.css'

const theme: Theme = {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('WelcomePage', WelcomePage)
    app.component('DemoPair', DemoPair)
    app.component('CuratedPlayground', CuratedPlayground)
  }
}

export default theme