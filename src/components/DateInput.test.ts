import { describe, it, expect } from 'vitest'
import { todayIso } from './DateInput'

describe('todayIso', () => {
  it('returns a YYYY-MM-DD string matching the local date', () => {
    const iso = todayIso()
    const now = new Date()
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    expect(iso).toBe(expected)
  })
})
