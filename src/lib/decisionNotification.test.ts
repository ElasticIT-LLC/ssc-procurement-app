import { describe, it, expect } from 'vitest'
import { decisionNotificationKey } from './decisionNotification'

describe('decisionNotificationKey', () => {
  it('maps approved to item_approved', () => {
    expect(decisionNotificationKey('approved')).toBe('item_approved')
  })

  it('maps declined to item_declined', () => {
    expect(decisionNotificationKey('declined')).toBe('item_declined')
  })

  it('maps on_hold to item_on_hold (regression: used to emit item_declined)', () => {
    expect(decisionNotificationKey('on_hold')).toBe('item_on_hold')
  })
})
