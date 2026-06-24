// ESM shim for use-sync-external-store/with-selector.
// React 19 has useSyncExternalStore built-in; this wraps it
// with the selector pattern that libraries like recharts expect.
import { useRef, useCallback } from 'react'
import { useSyncExternalStore } from 'react'

export function useSyncExternalStoreWithSelector(
  subscribe,
  getSnapshot,
  getServerSnapshot,
  selector,
  isEqual
) {
  const instRef = useRef(null)

  const getSelection = useCallback(() => {
    const nextSnapshot = getSnapshot()
    const nextSelection = selector(nextSnapshot)

    if (instRef.current !== null && isEqual !== undefined) {
      const prevSelection = instRef.current
      if (isEqual(prevSelection, nextSelection)) {
        return prevSelection
      }
    }

    instRef.current = nextSelection
    return nextSelection
  }, [getSnapshot, selector, isEqual])

  return useSyncExternalStore(subscribe, getSelection, getServerSnapshot ? () => selector(getServerSnapshot()) : undefined)
}
