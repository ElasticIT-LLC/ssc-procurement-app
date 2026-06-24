import { lazy, type LazyExoticComponent, type ComponentType } from 'react'

export { default as App } from './App'

interface AppAPI {
  registerPage: (key: string, component: LazyExoticComponent<ComponentType>) => void
}

export const setup = (api: AppAPI) => {
  api.registerPage('dashboard', lazy(() => import('./pages/DashboardPage')))
}
