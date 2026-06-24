import { useShellContext } from '@elasticit-llc/app-bridge'

export function DashboardPage() {
  const { user } = useShellContext()

  return (
    <div>
      <h1 className="text-2xl font-semibold text-foreground mb-4">Dashboard</h1>
      <p className="text-muted-foreground">Welcome, {user?.name ?? 'Guest'}</p>
    </div>
  )
}

export default DashboardPage
