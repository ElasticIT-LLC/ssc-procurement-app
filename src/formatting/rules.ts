import type { Tone } from './tones'

export type FormatField = 'status' | 'date_needed' | 'eta' | 'quantity' | 'department' | 'location' | 'item_description'
export type FormatOperator = 'equals' | 'not_equals' | 'contains' | 'gt' | 'lt' | 'gte' | 'lte' | 'before' | 'after' | 'is_overdue' | 'is_empty' | 'is_not_empty'
export interface FormatRule { id: string; label?: string; field: FormatField; operator: FormatOperator; value: string | null; tone: Tone; bold?: boolean; italic?: boolean; underline?: boolean; enabled: boolean }

export const FIELD_OPTIONS: { field: FormatField; label: string; type: 'status' | 'date' | 'number' | 'text' }[] = [
  { field: 'status', label: 'Status', type: 'status' },
  { field: 'date_needed', label: 'Date needed', type: 'date' },
  { field: 'eta', label: 'ETA', type: 'date' },
  { field: 'quantity', label: 'Quantity', type: 'number' },
  { field: 'department', label: 'Department', type: 'text' },
  { field: 'location', label: 'Location', type: 'text' },
  { field: 'item_description', label: 'Item', type: 'text' },
]
export const OPERATOR_OPTIONS: Record<'status' | 'date' | 'number' | 'text', { op: FormatOperator; label: string }[]> = {
  status: [{ op: 'equals', label: 'is' }, { op: 'not_equals', label: 'is not' }],
  date: [{ op: 'is_overdue', label: 'is overdue' }, { op: 'before', label: 'before' }, { op: 'after', label: 'after' }, { op: 'is_empty', label: 'is empty' }, { op: 'is_not_empty', label: 'is set' }],
  number: [{ op: 'equals', label: '=' }, { op: 'gt', label: '>' }, { op: 'lt', label: '<' }, { op: 'gte', label: '≥' }, { op: 'lte', label: '≤' }],
  text: [{ op: 'equals', label: 'is' }, { op: 'not_equals', label: 'is not' }, { op: 'contains', label: 'contains' }, { op: 'is_empty', label: 'is empty' }, { op: 'is_not_empty', label: 'is set' }],
}

// Built-in defaults — mirror STATUS_TONE so row tints match the status badges. Overdue first.
export const DEFAULT_RULES: FormatRule[] = [
  { id: 'overdue', label: 'Overdue', field: 'date_needed', operator: 'is_overdue', value: null, tone: 'red', enabled: true },
  { id: 'declined', label: 'Declined', field: 'status', operator: 'equals', value: 'declined', tone: 'red', enabled: true },
  { id: 'on_hold', label: 'On hold', field: 'status', operator: 'equals', value: 'on_hold', tone: 'amber', enabled: true },
  { id: 'returned', label: 'Returned', field: 'status', operator: 'equals', value: 'returned', tone: 'amber', enabled: true },
  { id: 'approved', label: 'Approved', field: 'status', operator: 'equals', value: 'approved', tone: 'green', enabled: true },
  { id: 'received', label: 'Received', field: 'status', operator: 'equals', value: 'received', tone: 'green', enabled: true },
  { id: 'ordered', label: 'Ordered', field: 'status', operator: 'equals', value: 'ordered', tone: 'blue', enabled: true },
  { id: 'replacement_ordered', label: 'Replacement ordered', field: 'status', operator: 'equals', value: 'replacement_ordered', tone: 'blue', enabled: true },
]

const TERMINAL = ['received', 'returned', 'replacement_ordered', 'declined']

function parseDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}
function fieldValue(row: Record<string, unknown>, field: FormatField): unknown {
  if (field === 'department') return (row.department as { name?: string } | null)?.name ?? row.custom_department ?? null
  if (field === 'location') return (row.location as { name?: string } | null)?.name ?? row.custom_location ?? null
  return row[field]
}
function matchRule(row: Record<string, unknown>, r: FormatRule, now: Date): boolean {
  const v = fieldValue(row, r.field)
  switch (r.operator) {
    case 'is_empty': return v == null || v === ''
    case 'is_not_empty': return v != null && v !== ''
    case 'is_overdue': {
      if (!v) return false
      const d = parseDate(String(v)); if (!d) return false
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      return d < today && !TERMINAL.includes(String(row.status))
    }
    case 'before': { const d = parseDate(String(v)); const rv = r.value ? parseDate(r.value) : null; return !!d && !!rv && d < rv }
    case 'after': { const d = parseDate(String(v)); const rv = r.value ? parseDate(r.value) : null; return !!d && !!rv && d > rv }
    case 'equals': return String(v ?? '').toLowerCase() === String(r.value ?? '').toLowerCase()
    case 'not_equals': return String(v ?? '').toLowerCase() !== String(r.value ?? '').toLowerCase()
    case 'contains': return String(v ?? '').toLowerCase().includes(String(r.value ?? '').toLowerCase())
    case 'gt': return !isNaN(Number(v)) && Number(v) > Number(r.value)
    case 'lt': return !isNaN(Number(v)) && Number(v) < Number(r.value)
    case 'gte': return !isNaN(Number(v)) && Number(v) >= Number(r.value)
    case 'lte': return !isNaN(Number(v)) && Number(v) <= Number(r.value)
    default: return false
  }
}
// Presentation of the first enabled matching rule: background tone plus any
// font flags. Total: never throws. Legacy rules without font flags render none.
export interface RowFormat { tone: Tone; bold: boolean; italic: boolean; underline: boolean }
export function evalRowFormat(row: Record<string, unknown>, rules: FormatRule[], now: Date = new Date()): RowFormat {
  for (const r of rules) {
    if (!r.enabled) continue
    try {
      if (matchRule(row, r, now)) return { tone: r.tone, bold: !!r.bold, italic: !!r.italic, underline: !!r.underline }
    } catch { /* skip bad rule */ }
  }
  return { tone: 'neutral', bold: false, italic: false, underline: false }
}
