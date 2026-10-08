import { describe, it, expect } from 'vitest'
import { glChipReducer, GL_CHIP_INIT } from './glChipState'

describe('glChipReducer', () => {
  it('initial state is idle with no value', () => {
    expect(GL_CHIP_INIT).toEqual({ phase: 'idle', value: '', token: 0 })
  })

  it('typing a name moves the chip to suggesting and bumps the token', () => {
    const next = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'Dell monitor' })
    expect(next.phase).toBe('suggesting')
    expect(next.token).toBe(1)
    expect(next.value).toBe('')
  })

  it('re-typing keeps the current value visible while suggesting again', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const suggested = glChipReducer(suggesting, { type: 'SUGGESTED', token: 1, code: 'IT: Computer Accessories' })
    const retyped = glChipReducer(suggested, { type: 'INPUT_CHANGED', name: 'b' })
    expect(retyped.phase).toBe('suggesting')
    expect(retyped.value).toBe('IT: Computer Accessories')
    expect(retyped.token).toBe(2)
  })

  it('clearing the name resets to idle with an empty value', () => {
    const suggested = glChipReducer(
      glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' }),
      { type: 'SUGGESTED', token: 1, code: 'IT: Computer Accessories' },
    )
    const cleared = glChipReducer(suggested, { type: 'INPUT_CHANGED', name: '' })
    expect(cleared).toEqual({ phase: 'idle', value: '', token: 2 })
  })

  it('ignores a stale TIMER_FIRED (debounce superseded)', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const retyped = glChipReducer(suggesting, { type: 'INPUT_CHANGED', name: 'b' })
    expect(glChipReducer(retyped, { type: 'TIMER_FIRED', token: 1 })).toEqual(retyped)
  })

  it('applies a SUGGESTED result for the current token', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const next = glChipReducer(suggesting, { type: 'SUGGESTED', token: 1, code: 'Medical: Medical Supplies' })
    expect(next.phase).toBe('suggested')
    expect(next.value).toBe('Medical: Medical Supplies')
  })

  it('ignores a stale SUGGESTED after the user picked (late reply must not overwrite)', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const picked = glChipReducer(suggesting, { type: 'USER_PICKED', code: 'IT: Computer Accessories' })
    const late = glChipReducer(picked, { type: 'SUGGESTED', token: 1, code: 'Marketing: Alumni Program' })
    expect(late.phase).toBe('edited')
    expect(late.value).toBe('IT: Computer Accessories')
  })

  it('moves to unavailable on SUGGEST_FAILED, keeping any prior value', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const failed = glChipReducer(suggesting, { type: 'SUGGEST_FAILED', token: 1 })
    expect(failed.phase).toBe('unavailable')
    expect(failed.value).toBe('')
  })

  it('ignores a stale SUGGEST_FAILED', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const picked = glChipReducer(suggesting, { type: 'USER_PICKED', code: 'IT: Computer Accessories' })
    expect(glChipReducer(picked, { type: 'SUGGEST_FAILED', token: 1 })).toEqual(picked)
  })

  it('USER_PICKED marks the value edited and bumps the token (cancels in-flight)', () => {
    const suggesting = glChipReducer(GL_CHIP_INIT, { type: 'INPUT_CHANGED', name: 'a' })
    const picked = glChipReducer(suggesting, { type: 'USER_PICKED', code: 'Client Services: Food Supplies' })
    expect(picked.phase).toBe('edited')
    expect(picked.value).toBe('Client Services: Food Supplies')
    expect(picked.token).toBe(2)
  })
})
