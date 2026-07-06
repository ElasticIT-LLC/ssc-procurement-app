import { describe, it, expect } from 'vitest'
import { formatRequestNo, formatItemRef } from './itemRef'

describe('formatRequestNo', () => {
  it('formats a number', () => expect(formatRequestNo(123)).toBe('#123'))
  it('handles null', () => expect(formatRequestNo(null)).toBe('#—'))
  it('handles undefined', () => expect(formatRequestNo(undefined)).toBe('#—'))
})

describe('formatItemRef', () => {
  it('formats request + line', () => expect(formatItemRef(123, 2)).toBe('#123-2'))
  it('omits line when null', () => expect(formatItemRef(123, null)).toBe('#123'))
  it('handles null request', () => expect(formatItemRef(null, 2)).toBe('#—'))
})
