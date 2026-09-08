export type Tone = 'neutral' | 'green' | 'red' | 'amber' | 'blue'
// Literal classes so Tailwind's @source scan bundles them. These are the exact STATUS_TONE tint
// families (theme-adaptive in light + dark). Do NOT use hex or full-strength backgrounds.
export const TONE_CLASS: Record<Tone, string> = {
  neutral: '',
  green: 'bg-success/15',
  red: 'bg-destructive/15',
  amber: 'bg-warning/15',
  blue: 'bg-info/15',
}
// Literal font-style classes (same @source-scan constraint as TONE_CLASS).
export const FONT_CLASS = { bold: 'font-bold', italic: 'italic', underline: 'underline' } as const
export const TONE_OPTIONS: { tone: Tone; label: string }[] = [
  { tone: 'neutral', label: 'None' },
  { tone: 'green', label: 'Green' },
  { tone: 'red', label: 'Red' },
  { tone: 'amber', label: 'Amber' },
  { tone: 'blue', label: 'Blue' },
]
