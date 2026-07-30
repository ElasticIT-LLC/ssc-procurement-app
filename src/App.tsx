import { useShellContext } from '@elasticit-llc/app-bridge'
import { DashboardPage } from './pages/DashboardPage'
import { RequestsPage } from './pages/RequestsPage'
import { ApprovalsPage } from './pages/ApprovalsPage'
import { PurchasingPage } from './pages/PurchasingPage'
import { ReturnsPage } from './pages/ReturnsPage'
import { RecordsPage } from './records/RecordsPage'
import { AdminPage } from './pages/AdminPage'
import { PublicRequestFormPage } from './pages/PublicRequestFormPage'
import './app.css'

export default function App() {
  const { currentPage } = useShellContext()
  switch (currentPage) {
    case 'requests':   return <RequestsPage />
    case 'approvals':  return <ApprovalsPage />
    case 'purchasing': return <PurchasingPage />
    case 'returns':    return <ReturnsPage />
    case 'records':       return <RecordsPage />
    case 'admin':         return <AdminPage />
    case 'request-form':  return <PublicRequestFormPage />
    case 'dashboard':
    default:              return <DashboardPage />
  }
}
