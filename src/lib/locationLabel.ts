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

// z8ygbxr03a/03b: distinct, alphabetized display names for items' requested
// locations (for the segment filters). Items whose location resolves to
// nothing are skipped.
export function distinctLocationNames(
  items: { location_id: string | null; custom_location: string | null }[],
  locations: LocationRef[],
): string[] {
  const names = items
    .map((i) => resolveLocationName(i, locations))
    .filter((n): n is string => !!n)
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}
