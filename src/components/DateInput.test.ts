import { describe, it, expect } from 'vitest'
import { todayIso, minEtaIso } from './DateInput'

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string matching the local date', () => {
    const iso = todayIso()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(iso).toBe(expected)
  })
})

describe('minEtaIso', () => {
  it('returns today plus 5 days as YYYY-MM-DD (local)', () => {
    const now = new Date()
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 5)
    const expected = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    expect(minEtaIso()).toBe(expected)
  })
})
