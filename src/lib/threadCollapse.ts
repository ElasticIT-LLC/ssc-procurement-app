// Thread collapse state for RequestThread (spec C3: collapsed by default,
// newest thread auto-expanded, click toggles). Pure functions so the toggle
// semantics are unit-testable without rendering.
//
// `override` maps rootId -> explicit collapsed state chosen by the user.
// A missing entry means "use the default" (everything collapsed except newest).

export function isThreadCollapsed(override: Record<string, boolean>, rootId: string, newestRootId: string | null): boolean {
  return override[rootId] ?? rootId !== newestRootId
}

// Returns the next override map after the user clicks the header of a thread
// currently in the `open` state. The override stores the *collapsed* state,
// so the new collapsed state equals the current open state.
export function toggleThread(override: Record<string, boolean>, rootId: string, open: boolean): Record<string, boolean> {
  return { ...override, [rootId]: open }
}
