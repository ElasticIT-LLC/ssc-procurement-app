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
