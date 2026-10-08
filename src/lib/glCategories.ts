// GL category list + dropdown grouping. Codes are the client's exact labels
// ("Dept: Name"); grouping splits on the first ": " for the dropdown's optgroups.

export interface GlCategory {
  id: string
  code: string
  active: boolean
}

export function groupGlCategories(codes: string[]): { group: string; codes: string[] }[] {
  const groups = new Map<string, { group: string; codes: string[] }>()
  for (const code of codes) {
    const sep = code.indexOf(': ')
    const group = sep >= 0 ? code.slice(0, sep) : 'Other'
    let entry = groups.get(group)
    if (!entry) {
      entry = { group, codes: [] }
      groups.set(group, entry)
    }
    entry.codes.push(code)
  }
  return [...groups.values()]
}
