import { useMemo, useState } from 'react'
import { useShellContext, useToast } from '@elasticit-llc/app-bridge'
import { useProcurementApi, type LineItemRow, type MentionCandidate, type RequestCommentRow, type RequestRow } from '../data/db'
import { useAppPermissions } from '../lib/useAppPermissions'
import { PERMS, formatDate } from '../lib/constants'
import { formatItemRef } from '../lib/itemRef'
import { parseMentions } from '../lib/mentions'

const TIME_FMT: Intl.DateTimeFormatOptions = { month: '2-digit', day: '2-digit', year: 'numeric', hour: 'numeric', minute: '2-digit' }

const SOURCE_LABEL: Record<RequestCommentRow['source'], string> = {
  request: 'Request',
  approvals: 'Approvals',
  purchasing: 'Purchasing',
  request_notes: 'Request notes',
}

function RoleBadge({ role }: { role: RequestCommentRow['author_role'] }) {
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${role === 'staff' ? 'bg-info/15 text-info' : 'bg-muted text-muted-foreground'}`}>
      {role === 'staff' ? 'Staff' : 'Requester'}
    </span>
  )
}

function MentionList({ candidates, onPick }: { candidates: MentionCandidate[]; onPick: (c: MentionCandidate) => void }) {
  if (candidates.length === 0) return <p className="text-[11px] text-muted-foreground">No matching people</p>
  return (
    <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-card shadow-sm">
      {candidates.map((c) => (
        <button key={c.user_id} type="button" onClick={() => onPick(c)} className="w-full px-2 py-1 text-left text-xs text-foreground hover:bg-muted">
          {c.display_name ?? c.email}
          {c.email ? <span className="text-muted-foreground"> ({c.email})</span> : null}
        </button>
      ))}
    </div>
  )
}

function trailingMention(text: string): { start: number; query: string } | null {
  const idx = text.lastIndexOf('@')
  if (idx === -1) return null
  const after = text.slice(idx + 1)
  return /\s/.test(after) ? null : { start: idx, query: after }
}

interface RequestThreadProps {
  request: RequestRow
  items: LineItemRow[]
  comments: RequestCommentRow[]
  onPosted: () => void
}

export function RequestThread({ request, items, comments, onPosted }: RequestThreadProps) {
  const api = useProcurementApi()
  const { showToast } = useToast()
  const { hasAppPermission } = useAppPermissions()
  const { user } = useShellContext()

  const [draft, setDraft] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [collapseOverride, setCollapseOverride] = useState<Record<string, boolean>>({})
  const [busy, setBusy] = useState(false)
  const [pickerFor, setPickerFor] = useState<'new' | string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [candidates, setCandidates] = useState<MentionCandidate[]>([])

  const isStaff = hasAppPermission(PERMS.approve) || hasAppPermission(PERMS.purchase) || hasAppPermission(PERMS.admin)
  const isRequester = !!user && ((request.requester_id !== null && user.id === request.requester_id)
    || (request.requester_id === null && !!user.email && !!request.requester_email
      && user.email.toLowerCase() === request.requester_email.toLowerCase()))
  const canComment = isStaff || isRequester

  const roots = useMemo(
    () => comments.filter((c) => c.parent_id === null).sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [comments],
  )
  const repliesByRoot = useMemo(() => {
    const map: Record<string, RequestCommentRow[]> = {}
    for (const c of comments) if (c.parent_id) (map[c.parent_id] ??= []).push(c)
    for (const key of Object.keys(map)) (map[key] ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at))
    return map
  }, [comments])

  // Collapsed by default; the newest thread auto-expands.
  const newestRootId = roots[0]?.id ?? null
  const isCollapsed = (rootId: string) => collapseOverride[rootId] ?? rootId !== newestRootId

  const itemRef = (lineItemId: string | null): string | null => {
    if (!lineItemId) return null
    const li = items.find((i) => i.id === lineItemId)
    return li ? formatItemRef(request.request_number, li.line_no) : null
  }

  async function loadCandidates() {
    try { setCandidates(await api.listMentionCandidates(request.id)) } catch { setCandidates([]) }
  }

  function trackMention(target: 'new' | string, text: string) {
    const tm = trailingMention(text)
    if (tm) {
      setPickerFor(target)
      setPickerQuery(tm.query)
      if (candidates.length === 0) void loadCandidates()
    } else if (pickerFor !== null) {
      setPickerFor(null)
    }
  }

  const visibleCandidates = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase()
    if (!q) return candidates
    return candidates.filter((c) => (c.display_name?.toLowerCase().includes(q) ?? false) || (c.email?.toLowerCase().includes(q) ?? false))
  }, [candidates, pickerQuery])

  function applyMention(target: 'new' | string, c: MentionCandidate) {
    const label = `@${c.display_name ?? c.email?.split('@')[0] ?? ''} `
    if (target === 'new') {
      const tm = trailingMention(draft)
      if (tm) setDraft(draft.slice(0, tm.start) + label)
    } else {
      const text = replyDrafts[target] ?? ''
      const tm = trailingMention(text)
      if (tm) setReplyDrafts((d) => ({ ...d, [target]: text.slice(0, tm.start) + label }))
    }
    setPickerFor(null)
    setPickerQuery('')
  }

  async function post(body: string, parent: RequestCommentRow | null) {
    const trimmed = body.trim()
    if (!trimmed) return
    setBusy(true)
    try {
      const row = await api.postRequestComment({
        request_id: request.id,
        parent_id: parent?.id ?? null,
        line_item_id: parent?.line_item_id ?? null,
        source: 'request',
        body: trimmed,
        mentions: parseMentions(trimmed, candidates),
      })
      api.fireCommentNotification(row.id)
      setDraft('')
      if (parent) setReplyDrafts((d) => ({ ...d, [parent.id]: '' }))
      showToast({ message: 'Comment posted', type: 'success' })
      onPosted()
    } catch (err: unknown) {
      showToast({ message: err instanceof Error ? err.message : 'Failed to post comment', type: 'error' })
    } finally {
      setBusy(false)
    }
  }

  if (!canComment && comments.length === 0) return null

  return (
    <div className="grid gap-3">
      {canComment && (
        <div className="grid gap-2 rounded-lg border border-border bg-card p-3">
          <label className="text-xs font-medium text-foreground">New comment</label>
          <textarea
            rows={2}
            maxLength={1000}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); trackMention('new', e.target.value) }}
            placeholder="Add a comment… use @ to mention"
            className="w-full resize-none rounded-md border border-input bg-input px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
          {pickerFor === 'new' && <MentionList candidates={visibleCandidates} onPick={(c) => applyMention('new', c)} />}
          <div className="flex justify-end">
            <button
              type="button"
              disabled={busy || !draft.trim()}
              onClick={() => post(draft, null)}
              className="inline-flex items-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              Post
            </button>
          </div>
        </div>
      )}

      {roots.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}

      {roots.map((root) => {
        const replies = repliesByRoot[root.id] ?? []
        const open = !isCollapsed(root.id)
        return (
          <div key={root.id} className="rounded-lg border border-border bg-card">
            <button
              type="button"
              onClick={() => setCollapseOverride((m) => ({ ...m, [root.id]: !open }))}
              className="flex w-full items-center gap-2 px-3 py-2 text-left"
            >
              <span className="text-xs text-muted-foreground">{open ? '▾' : '▸'}</span>
              <span className="text-sm font-medium text-foreground">{root.author_name}</span>
              <RoleBadge role={root.author_role} />
              {root.source !== 'request' && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{SOURCE_LABEL[root.source]}</span>
              )}
              {itemRef(root.line_item_id) && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">{itemRef(root.line_item_id)}</span>
              )}
              <span className="ml-auto whitespace-nowrap text-[11px] text-muted-foreground">
                {formatDate(root.created_at, TIME_FMT)} · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </span>
            </button>
            {open && (
              <div className="grid gap-2 border-t border-border px-3 pb-3 pt-2">
                <p className="text-sm whitespace-pre-wrap break-words text-foreground">{root.body}</p>
                {replies.map((r) => (
                  <div key={r.id} className="ml-4 grid gap-0.5 rounded-md bg-muted/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-foreground">{r.author_name}</span>
                      <RoleBadge role={r.author_role} />
                      <span className="text-[11px] text-muted-foreground">{formatDate(r.created_at, TIME_FMT)}</span>
                    </div>
                    <p className="text-sm whitespace-pre-wrap break-words text-foreground">{r.body}</p>
                  </div>
                ))}
                {canComment && (
                  <div className="ml-4 grid gap-1">
                    <textarea
                      rows={1}
                      maxLength={1000}
                      value={replyDrafts[root.id] ?? ''}
                      onChange={(e) => { setReplyDrafts((d) => ({ ...d, [root.id]: e.target.value })); trackMention(root.id, e.target.value) }}
                      placeholder="Reply…"
                      className="w-full resize-none rounded-md border border-input bg-input px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                    {pickerFor === root.id && <MentionList candidates={visibleCandidates} onPick={(c) => applyMention(root.id, c)} />}
                    <div className="flex justify-end">
                      <button
                        type="button"
                        disabled={busy || !(replyDrafts[root.id] ?? '').trim()}
                        onClick={() => post(replyDrafts[root.id] ?? '', root)}
                        className="inline-flex items-center border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                      >
                        Reply
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default RequestThread
