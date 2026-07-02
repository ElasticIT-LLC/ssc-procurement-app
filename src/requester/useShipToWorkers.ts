import { useCallback, useEffect, useState } from 'react'
import { useProcurementApi, ShipToWorker } from '../data/db'

// Loads the active-Rippling-worker list once when a form mounts and exposes a
// manual refresh (which bypasses the edge fn's 6h server cache). Shared by every
// LineItemFormRow on the form via the parent, so one refresh() updates all rows.
export function useShipToWorkers() {
  const api = useProcurementApi()
  const [workers, setWorkers] = useState<ShipToWorker[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (refresh: boolean) => {
    setLoading(true)
    setError(null)
    try {
      setWorkers(await api.listShipToWorkers({ refresh }))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load workers')
    } finally {
      setLoading(false)
    }
    // api is a fresh object each render (useProcurementApi); intentionally not a
    // dep, matching the existing NewRequestForm effect pattern.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => { load(false) }, [load])
  const refresh = useCallback(() => load(true), [load])

  return { workers, loading, error, refresh }
}
