import { describe, it, expect } from 'vitest'
import { isThreadCollapsed, toggleThread } from './threadCollapse'

describe('thread collapse state', () => {
  it('collapses all but the newest thread by default', () => {
    expect(isThreadCollapsed({}, 'older', 'newest')).toBe(true)
    expect(isThreadCollapsed({}, 'newest', 'newest')).toBe(false)
  })

  it('expands a collapsed thread when its header is toggled', () => {
    const before = isThreadCollapsed({}, 'older', 'newest')
    const after = toggleThread({}, 'older', !before)
    expect(isThreadCollapsed(after, 'older', 'newest')).toBe(false)
  })

  it('collapses the open newest thread when its header is toggled', () => {
    const before = isThreadCollapsed({}, 'newest', 'newest')
    const after = toggleThread({}, 'newest', !before)
    expect(isThreadCollapsed(after, 'newest', 'newest')).toBe(true)
  })

  it('toggling twice restores the previous state', () => {
    let m = toggleThread({}, 'older', false)
    m = toggleThread(m, 'older', true)
    expect(isThreadCollapsed(m, 'older', 'newest')).toBe(true)
  })

  it('toggling one thread does not affect another', () => {
    const m = toggleThread({}, 'older', false)
    expect(isThreadCollapsed(m, 'newest', 'newest')).toBe(false)
    expect(isThreadCollapsed(m, 'third', 'newest')).toBe(true)
  })
})
