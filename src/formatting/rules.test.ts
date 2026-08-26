import { describe, it, expect } from 'vitest'
import { evalRowFormat, DEFAULT_RULES, type FormatRule } from './rules'

const base: FormatRule = { id: 'x', field: 'status', operator: 'equals', value: 'pending', tone: 'blue', enabled: true }

describe('evalRowFormat', () => {
  it('returns matched tone and font flags', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, bold: true, underline: true }])
    expect(f).toEqual({ tone: 'blue', bold: true, italic: false, underline: true })
  })

  it('defaults font flags to false for legacy saved rules', () => {
    const f = evalRowFormat({ status: 'pending' }, [base])
    expect(f).toEqual({ tone: 'blue', bold: false, italic: false, underline: false })
  })

  it('first enabled match wins', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, tone: 'red', bold: true }, { ...base, tone: 'green' }])
    expect(f.tone).toBe('red')
    expect(f.bold).toBe(true)
  })

  it('skips disabled rules', () => {
    const f = evalRowFormat({ status: 'pending' }, [{ ...base, enabled: false }])
    expect(f.tone).toBe('neutral')
  })

  it('overdue default rule tints past date_needed red', () => {
    const f = evalRowFormat({ status: 'pending', date_needed: '2020-01-01' }, DEFAULT_RULES)
    expect(f.tone).toBe('red')
  })

  it('returns neutral with no matches', () => {
    const f = evalRowFormat({ status: 'received' }, [base])
    expect(f).toEqual({ tone: 'neutral', bold: false, italic: false, underline: false })
  })

  it('keeps first match for tone but accumulates font flags across all matches', () => {
    // Row matches overdue (red, no fonts) AND approved (green, bold+italic):
    // tone must come from the first match (overdue/red), fonts from both.
    const f = evalRowFormat(
      { status: 'approved', date_needed: '2020-01-01' },
      DEFAULT_RULES.map((r) =>
        r.id === 'approved' ? { ...r, bold: true, italic: true } : r,
      ),
    )
    expect(f).toEqual({ tone: 'red', bold: true, italic: true, underline: false })
  })

  it('font flags from a non-matching rule do not leak', () => {
    const f = evalRowFormat(
      { status: 'approved' },
      [
        { id: 'a', field: 'status', operator: 'equals', value: 'approved', tone: 'green', enabled: true },
        { id: 'b', field: 'status', operator: 'equals', value: 'ordered', tone: 'blue', bold: true, enabled: true },
      ],
    )
    expect(f).toEqual({ tone: 'green', bold: false, italic: false, underline: false })
  })
})
