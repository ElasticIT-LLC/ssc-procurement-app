import { describe, it, expect } from 'vitest'
import { viewFromSearch, purchasingTabFromSearch } from './params'

describe('viewFromSearch', () => {
  it('defaults to the list view', () => {
    expect(viewFromSearch('')).toEqual({ type: 'list' })
  })
  it('restores the detail view from ?request=<id>', () => {
    expect(viewFromSearch('?request=abc-123')).toEqual({ type: 'detail', id: 'abc-123' })
  })
  it('falls back to the list view when the param is empty', () => {
    expect(viewFromSearch('?request=')).toEqual({ type: 'list' })
  })
  it('ignores unrelated params', () => {
    expect(viewFromSearch('?foo=bar')).toEqual({ type: 'list' })
  })
  it('decodes a URL-encoded id', () => {
    expect(viewFromSearch('?request=a%20b')).toEqual({ type: 'detail', id: 'a b' })
  })
})

describe('purchasingTabFromSearch', () => {
  it('defaults to ready when there is no tab param', () => {
    expect(purchasingTabFromSearch('')).toBe('ready')
    expect(purchasingTabFromSearch('?request=abc')).toBe('ready')
  })
  it('reads each valid tab', () => {
    expect(purchasingTabFromSearch('?tab=ready')).toBe('ready')
    expect(purchasingTabFromSearch('?tab=open')).toBe('open')
    expect(purchasingTabFromSearch('?tab=closed')).toBe('closed')
    expect(purchasingTabFromSearch('?tab=favorites')).toBe('favorites')
  })
  it('falls back to ready for invalid or empty values', () => {
    expect(purchasingTabFromSearch('?tab=bogus')).toBe('ready')
    expect(purchasingTabFromSearch('?tab=')).toBe('ready')
  })
})
