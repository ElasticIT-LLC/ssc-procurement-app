import { describe, it, expect } from 'vitest'
import { filterFavorites } from './ItemNameCombobox'
import type { FavoriteItem } from '../data/db'

function fav(id: string, name: string): FavoriteItem {
  return { id, name, item_url: null, created_by: null, created_at: '' }
}

describe('filterFavorites', () => {
  it('returns all favorites for an empty query', () => {
    const list = [fav('1', 'Dell 27" Monitor'), fav('2', 'HP Keyboard')]
    expect(filterFavorites(list, '')).toHaveLength(2)
    expect(filterFavorites(list, '   ')).toHaveLength(2)
  })

  it('filters case-insensitive substring', () => {
    const list = [fav('1', 'Dell 27" Monitor'), fav('2', 'HP Keyboard')]
    expect(filterFavorites(list, 'dell')).toEqual([fav('1', 'Dell 27" Monitor')])
  })

  it('trims the query before matching', () => {
    const list = [fav('1', 'Dell 27" Monitor')]
    expect(filterFavorites(list, '  dell  ')).toHaveLength(1)
  })

  it('returns empty when nothing matches', () => {
    expect(filterFavorites([fav('1', 'Dell 27" Monitor')], 'nonexistent')).toEqual([])
  })
})
