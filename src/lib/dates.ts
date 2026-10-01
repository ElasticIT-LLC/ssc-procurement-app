// Pure ISO-date helpers shared by form components and pre-approved prefill
// logic. Kept out of component files so non-UI modules (e.g. preApproved.ts)
// can use them without importing React.

function toIso(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function todayIso(): string {
  return toIso(new Date())
}

/** Earliest valid ETA: local today + 5 days, ISO YYYY-MM-DD. */
export function minEtaIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 5)
  return toIso(d)
}
