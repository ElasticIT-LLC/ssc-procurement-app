import { lazy, type LazyExoticComponent, type ComponentType } from 'react'
export { default as App } from './App'
interface AppAPI { registerPage: (key: string, c: LazyExoticComponent<ComponentType>) => void }
export const setup = (api: AppAPI) => {
  api.registerPage('dashboard', lazy(() => import('./pages/DashboardPage')))
  api.registerPage('requests', lazy(() => import('./pages/RequestsPage')))
  api.registerPage('approvals', lazy(() => import('./pages/ApprovalsPage')))
  api.registerPage('purchasing', lazy(() => import('./pages/PurchasingPage')))
  api.registerPage('returns', lazy(() => import('./pages/ReturnsPage')))
  api.registerPage('records', lazy(() => import('./records/RecordsPage')))
  api.registerPage('admin', lazy(() => import('./pages/AdminPage')))
}
