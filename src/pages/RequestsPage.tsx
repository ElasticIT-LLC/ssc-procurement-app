import { useState } from 'react'
import { RequestsList } from '../requester/RequestsList'
import { NewRequestForm } from '../requester/NewRequestForm'
import { RequestDetail } from '../requester/RequestDetail'
import { FavoritesLink } from '../components/FavoritesModal'
import { viewFromSearch } from '../lib/params'

type View = { type: 'list' } | { type: 'new' } | { type: 'detail'; id: string }

// The open request is deep-linkable via ?request=<id> so a refresh lands back
// on the request detail instead of resetting to the list.
function syncViewToUrl(view: View) {
  const params = new URLSearchParams(window.location.search)
  if (view.type === 'detail') params.set('request', view.id)
  else params.delete('request')
  const qs = params.toString()
  window.history.replaceState(null, '', window.location.pathname + (qs ? `?${qs}` : '') + window.location.hash)
}

export function RequestsPage() {
  const [view, setView] = useState<View>(() => viewFromSearch(window.location.search))

  const changeView = (v: View) => {
    setView(v)
    syncViewToUrl(v)
  }

  return (
    <div className="mx-auto max-w-3xl py-6 px-4 grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Requests</h1>
        <p className="text-muted-foreground text-sm">Submit and track your purchase requests.</p>
      </div>

      {view.type === 'list' && (
        <RequestsList
          onNew={() => changeView({ type: 'new' })}
          onSelect={(id) => changeView({ type: 'detail', id })}
        />
      )}

      {view.type === 'new' && (
        <div className="grid gap-4">
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => changeView({ type: 'list' })}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-foreground">New Request</h2>
            <FavoritesLink />
          </div>
          <NewRequestForm
            onCancel={() => changeView({ type: 'list' })}
            onSuccess={() => changeView({ type: 'list' })}
          />
        </div>
      )}

      {view.type === 'detail' && (
        <RequestDetail
          requestId={view.id}
          onBack={() => changeView({ type: 'list' })}
        />
      )}
    </div>
  )
}

export default RequestsPage
