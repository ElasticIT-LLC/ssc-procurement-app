import { useState, useEffect } from 'react'
import { useProcurementApi } from '../data/db'
import { evalRowFormat, DEFAULT_RULES, type FormatRule } from './rules'
import { TONE_CLASS, FONT_CLASS } from './tones'

// Loads the active formatting rules once; returns a helper that maps a row to
// its combined tint + font-style classes. Starts from DEFAULT_RULES so tints
// show immediately, then overrides with any saved rules.
export function useFormattingRules(): { rules: FormatRule[]; toneClassFor: (row: Record<string, unknown>) => string } {
  const api = useProcurementApi()
  const [rules, setRules] = useState<FormatRule[]>(DEFAULT_RULES)
  useEffect(() => { api.getFormattingRules().then(setRules).catch(() => setRules(DEFAULT_RULES)) }, [])
  const toneClassFor = (row: Record<string, unknown>) => {
    const f = evalRowFormat(row, rules)
    return [TONE_CLASS[f.tone], f.bold ? FONT_CLASS.bold : '', f.italic ? FONT_CLASS.italic : '', f.underline ? FONT_CLASS.underline : '']
      .filter(Boolean).join(' ')
  }
  return { rules, toneClassFor }
}
