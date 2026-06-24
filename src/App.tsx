import { useShellContext } from '@elasticit-llc/app-bridge'
import { DashboardPage } from './pages/DashboardPage'
import { RequestsPage } from './pages/RequestsPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { PurchasingPage } from './pages/PurchasingPage'
import { ReturnsPage } from './pages/ReturnsPage'
import { AdminPage } from './pages/AdminPage'
import './app.css'

export default function App() {
  const { currentPage } = useShellContext()
  switch (currentPage) {
    case 'requests':   return <RequestsPage />
    case 'approvals':  return <ApprovalsPage />
    case 'purchasing': return <PurchasingPage />
    case 'returns':    return <ReturnsPage />
    case 'admin':      return <AdminPage />
    case 'dashboard':
    default:           return <DashboardPage />
  }
}
