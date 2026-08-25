import { useState } from 'react'
import { RequestsList } from '../requester/RequestsList'
import { NewRequestForm } from '../requester/NewRequestForm'
import { RequestDetail } from '../requester/RequestDetail'

type View = { type: 'list' } | { type: 'new' } | { type: 'detail'; id: string }

export function RequestsPage() {
  const [view, setView] = useState<View>({ type: 'list' })

  return (
    <div className="mx-auto max-w-3xl py-6 px-4 grid gap-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground mb-1">Requests</h1>
        <p className="text-muted-foreground text-sm">Submit and track your purchase requests.</p>
      </div>

      {view.type === 'list' && (
        <RequestsList
          onNew={() => setView({ type: 'new' })}
          onSelect={(id) => setView({ type: 'detail', id })}
        />
      )}

      {view.type === 'new' && (
        <div className="grid gap-4">
          <div className="flex flex-col items-start gap-1">
            <button
              type="button"
              onClick={() => setView({ type: 'list' })}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              ← Back
            </button>
            <h2 className="text-lg font-semibold text-foreground">New Request</h2>
          </div>
          <NewRequestForm
            onCancel={() => setView({ type: 'list' })}
            onSuccess={() => setView({ type: 'list' })}
          />
        </div>
      )}

      {view.type === 'detail' && (
        <RequestDetail
          requestId={view.id}
          onBack={() => setView({ type: 'list' })}
        />
      )}
    </div>
  )
}

export default RequestsPage
