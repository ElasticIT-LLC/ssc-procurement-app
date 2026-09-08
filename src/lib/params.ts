export function getQueryParam(name: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(name)
}

export type RequestsView = { type: 'list' } | { type: 'detail'; id: string }

// The open request is deep-linkable via ?request=<id> so a page refresh
// restores the detail view instead of falling back to the list.
export function viewFromSearch(search: string): RequestsView {
  const id = new URLSearchParams(search).get('request')
  return id ? { type: 'detail', id } : { type: 'list' }
}
