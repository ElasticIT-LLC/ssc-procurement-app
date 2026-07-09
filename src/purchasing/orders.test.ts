import { describe, it, expect } from 'vitest'
import { poReceiveProgress } from './orders'

describe('poReceiveProgress', () => {
  it('counts received vs total', () => {
    expect(poReceiveProgress([{ status: 'received' }, { status: 'ordered' }, { status: 'received' }]))
      .toEqual({ received: 2, total: 3 })
  })
  it('handles an empty PO', () => expect(poReceiveProgress([])).toEqual({ received: 0, total: 0 }))
})
