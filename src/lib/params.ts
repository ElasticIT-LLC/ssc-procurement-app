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

export type PurchasingTab = 'ready' | 'open' | 'closed' | 'favorites'

// z8ygbxr037: ?tab=<key> deep-link (pre-approved Create Order flow).
// Invalid/missing values fall back to 'ready'.
export function purchasingTabFromSearch(search: string): PurchasingTab {
  const t = new URLSearchParams(search).get('tab')
  return t === 'open' || t === 'closed' || t === 'favorites' ? t : 'ready'
}
