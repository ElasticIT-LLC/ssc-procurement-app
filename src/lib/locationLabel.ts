export interface LocationRef {
  id: string
  name: string
}

// Resolve the display name for a line item's requested location.
// Preferred: the active location referenced by location_id.
// Fallback: the free-text custom_location the requester typed.
// Returns null when neither resolves (caller hides the row).
export function resolveLocationName(
  item: { location_id: string | null; custom_location: string | null },
  locations: LocationRef[],
): string | null {
  if (item.location_id) {
    const loc = locations.find((l) => l.id === item.location_id)
    if (loc) return loc.name
  }
  const custom = item.custom_location?.trim()
  return custom || null
}

// z8ygbxr03a/03b (v3.1): options for the location chip filters — distinct
// alphabetized display names with per-location item counts. Items whose
// location resolves to nothing are skipped.
export function locationCounts(
  items: { location_id: string | null; custom_location: string | null }[],
  locations: LocationRef[],
): { value: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const item of items) {
    const name = resolveLocationName(item, locations)
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: 'base' }))
    .map(([value, count]) => ({ value, count }))
}

// If the selected filter value is no longer present in the options (e.g. the
// tab switched and the location left the view), fall back to 'all' so the UI
// and the filtering agree without mutating state.
export function effectiveFilterValue(value: string, options: { value: string }[]): string {
  return value === 'all' || options.some((o) => o.value === value) ? value : 'all'
}
