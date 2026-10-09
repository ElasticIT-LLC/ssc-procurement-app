import { describe, it, expect } from 'vitest'
import { normalizeGlReply } from './glNormalize'

const CODES = [
  'Facility: Facility/Building Supplies/In-House Maintenance',
  'IT: Computer Accessories',
  'Client Services: Hygiene/personal care',
]

describe('normalizeGlReply', () => {
  it('returns an exact code unchanged', () => {
    expect(normalizeGlReply('IT: Computer Accessories', CODES)).toBe('IT: Computer Accessories')
  })

  it('trims whitespace and surrounding quotes, returning the list casing', () => {
    expect(normalizeGlReply('  "it: computer accessories"  ', CODES)).toBe('IT: Computer Accessories')
  })

  it('matches case-insensitively and returns the list casing', () => {
    expect(normalizeGlReply('CLIENT SERVICES: HYGIENE/PERSONAL CARE', CODES)).toBe('Client Services: Hygiene/personal care')
  })

  it('returns null when the reply matches no code', () => {
    expect(normalizeGlReply('Office stuff, probably', CODES)).toBeNull()
  })

  it('returns null for empty replies', () => {
    expect(normalizeGlReply('', CODES)).toBeNull()
    expect(normalizeGlReply('   ', CODES)).toBeNull()
  })
})
