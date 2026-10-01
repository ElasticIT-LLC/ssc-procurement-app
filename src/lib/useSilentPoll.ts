import { useEffect, useRef } from 'react'

/**
 * Repeatedly calls `fn` on an interval without any loading-state churn — pass
 * the SILENT variant of the page loader so the UI never flickers "Loading…".
 *
 * Used to make lists pick up new rows (requests, approvals, decided items)
 * without a manual browser refresh (z8ygbxp4ch). Ticks are skipped while the
 * tab is hidden, and a slow in-flight refresh never overlaps the next tick.
 */
export function useSilentPoll(
  fn: () => void | Promise<unknown>,
  intervalMs = 10000,
  enabled = true,
): void {
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    if (!enabled) return
    let running = false
    const timer = window.setInterval(() => {
      if (running || document.hidden) return
      running = true
      Promise.resolve(fnRef.current())
        .catch(() => {
          // Silent by contract: a failed background refresh is retried on the
          // next tick; the on-screen data stays as-is.
        })
        .finally(() => {
          running = false
        })
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs, enabled])
}
