// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'

// Regression test for the 0.27.0 refetch loop: load's deps were [api] while
// useProcurementApi() returns a fresh object on every render, so the mount
// effect re-ran after every render — the Open Orders tab blinked "Loading…"
// endlessly and flooded the browser's connection queue (which also made the
// Closed Orders tab appear to load for minutes behind the backlog).
const mocks = vi.hoisted(() => ({
  listPurchaseOrders: vi.fn(async () => []),
  listLocations: vi.fn(async () => []),
  showToast: vi.fn(),
}))

vi.mock('../data/db', () => ({
  // Fresh object per call, mirroring the real (unmemoized) useProcurementApi.
  useProcurementApi: () => ({
    listPurchaseOrders: mocks.listPurchaseOrders,
    listLocations: mocks.listLocations,
  }),
}))
vi.mock('@elasticit-llc/app-bridge', () => ({
  useToast: () => ({ showToast: mocks.showToast }),
}))

import { OpenOrders } from './OpenOrders'

;(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true

describe('OpenOrders', () => {
  let container: HTMLDivElement
  let root: ReturnType<typeof createRoot>

  beforeEach(() => {
    mocks.listPurchaseOrders.mockClear()
    mocks.listLocations.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => { root.unmount() })
    container.remove()
  })

  it('fetches open orders exactly once on mount (no refetch loop)', async () => {
    await act(async () => {
      root.render(createElement(OpenOrders))
    })
    // The buggy loop re-runs the load effect on every render; give it room to cycle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500))
    })
    expect(mocks.listPurchaseOrders).toHaveBeenCalledTimes(1)
    expect(mocks.listLocations).toHaveBeenCalledTimes(1)
    expect(container.textContent).toContain('No open orders.')
  })
})
