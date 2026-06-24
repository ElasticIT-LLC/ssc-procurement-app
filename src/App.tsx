import { useShellContext } from '@elasticit-llc/app-bridge'
import { DashboardPage } from './pages/DashboardPage'
import './app.css'

export default function App() {
  const { currentPage } = useShellContext()

  switch (currentPage) {
    case 'dashboard':  return <DashboardPage />
    default:           return <DashboardPage />
  }
}
