import { describe, it, expect } from 'vitest'
import { FULL_ACCESS, hasAppPermission, PERMS } from './constants'

describe('hasAppPermission', () => {
  it('grants exact permission matches', () => {
    expect(hasAppPermission([PERMS.create], PERMS.create)).toBe(true)
    expect(hasAppPermission([PERMS.approve], PERMS.create)).toBe(false)
  })

  it('grants any procurement permission when user has FULL_ACCESS wildcard', () => {
    const perms = [FULL_ACCESS]
    expect(hasAppPermission(perms, PERMS.create)).toBe(true)
    expect(hasAppPermission(perms, PERMS.approve)).toBe(true)
    expect(hasAppPermission(perms, PERMS.purchase)).toBe(true)
    expect(hasAppPermission(perms, PERMS.returns)).toBe(true)
    expect(hasAppPermission(perms, PERMS.admin)).toBe(true)
  })

  it('grants global wildcard *', () => {
    const perms = ['*']
    expect(hasAppPermission(perms, PERMS.create)).toBe(true)
    expect(hasAppPermission(perms, 'any/permission')).toBe(true)
  })

  it('grants everything when user is a shell admin', () => {
    expect(hasAppPermission([], PERMS.create, true)).toBe(true)
    expect(hasAppPermission([], 'any/permission', true)).toBe(true)
  })

  it('does not grant unrelated permissions via FULL_ACCESS', () => {
    const perms = [FULL_ACCESS]
    expect(hasAppPermission(perms, 'apps/other-app/action')).toBe(false)
    expect(hasAppPermission(perms, 'some/unrelated/key')).toBe(false)
  })

  it('handles undefined permissions', () => {
    expect(hasAppPermission(undefined, PERMS.create)).toBe(false)
  })
})
