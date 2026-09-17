import { describe, it, expect } from 'vitest'
import { viewFromSearch } from './params'

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
