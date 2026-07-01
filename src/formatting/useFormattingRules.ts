import { useState, useEffect } from 'react'
import { useProcurementApi } from '../data/db'
import { evalRowTone, DEFAULT_RULES, type FormatRule } from './rules'
import { TONE_CLASS } from './tones'

// Loads the active formatting rules once; returns a helper that maps a row to its tint class.
// Starts from DEFAULT_RULES so tints show immediately, then overrides with any saved rules.
export function useFormattingRules(): { rules: FormatRule[]; toneClassFor: (row: Record<string, unknown>) => string } {
  const api = useProcurementApi()
  const [rules, setRules] = useState<FormatRule[]>(DEFAULT_RULES)
  useEffect(() => { api.getFormattingRules().then(setRules).catch(() => setRules(DEFAULT_RULES)) }, [])
  const toneClassFor = (row: Record<string, unknown>) => TONE_CLASS[evalRowTone(row, rules) ?? 'neutral']
  return { rules, toneClassFor }
}
