import { usePermissions, useShellContext } from '@elasticit-llc/app-bridge'
import { hasAppPermission } from './constants'

export function useAppPermissions() {
  const { appPermissions } = usePermissions()
  const { user } = useShellContext()
  const isAdmin = user?.role === 'admin'

  return {
    hasAppPermission: (key: string) => hasAppPermission(appPermissions, key, isAdmin),
    isAdmin,
    appPermissions,
  }
}
