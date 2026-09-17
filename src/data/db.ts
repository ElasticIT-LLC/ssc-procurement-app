import { useSupabase } from '@elasticit-llc/app-bridge'
import type { LineItemStatus, RequestStatus } from '../lib/constants'
import { DEFAULT_RULES, type FormatRule } from '../formatting/rules'
import { formatItemRef } from '../lib/itemRef'

const SCHEMA = 'app_procurement'
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments', config: '_config', purchaseOrders: 'purchase_orders', favoriteItems: 'favorite_items', preApprovedItems: 'pre_approved_items', comments: 'request_comments' } as const
const RPCS = { submit: 'submit_request', submitAnon: 'submit_request_anon', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return', setComment: 'set_line_item_comment', deleteItem: 'delete_line_item', archiveItem: 'archive_line_item', cancel: 'cancel_line_item', getUserNames: 'get_user_names', getFormattingRules: 'get_formatting_rules', createPO: 'create_purchase_order', closePO: 'close_purchase_order', preApprove: 'pre_approve_line_item', orderPreApproved: 'order_pre_approved_item', deletePreApproved: 'delete_pre_approved_item', postComment: 'post_request_comment', mentionCandidates: 'get_mention_candidates' } as const

export interface RequestRow { id: string; requester_id: string | null; requester_name: string | null; requester_email: string | null; requester_type: string; status: RequestStatus; notes: string | null; submitted_at: string; updated_at: string; request_number: number | null; line_items?: { item_description: string | null; item_url: string | null }[] }
export interface LineItemRow { id: string; request_id: string; item_description: string | null; item_url: string | null; memo: string | null; quantity: number; substitution_ok: boolean; status: LineItemStatus; location_id: string | null; custom_location: string | null; ship_to_name: string | null; shipping_location_id: string | null; custom_shipping_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; eta: string | null; admin_comment: string | null; commented_by: string | null; commented_at: string | null; product_image_path: string | null; return_reason: string | null; return_quantity: number | null; wants_replacement: boolean | null; return_notes: string | null; return_date: string | null; created_at: string; line_no: number | null; return_processed_at: string | null; po_id: string | null; archived_at: string | null; received_at: string | null; cancelled_at: string | null; pre_approved_item_id: string | null; approved_by: string | null; approval_date: string | null; date_purchased: string | null; updated_at: string }
export interface LineItemWithRequest extends LineItemRow {
  request: {
    id: string
    request_number: number | null
    requester_name: string | null
    requester_email: string | null
    notes: string | null
    submitted_at: string
  }
}
export interface PurchaseOrderRow {
  id: string
  po_number: string
  vendor: string | null
  status: 'open' | 'closed'
  created_by: string | null
  date_purchased: string | null
  eta: string | null
  shipping_location_id: string | null
  custom_shipping_location: string | null
  notes: string | null
  closed_at: string | null
  created_at: string
  line_items: LineItemWithRequest[]
}
// One flat row per line item for the Records table: line-item fields + admin_comment,
// the request it belongs to, and the resolved location/department names.
export interface LineItemDetailed extends LineItemRow {
  request: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
  location: { name: string } | null
  department: { name: string } | null
  po: { po_number: string } | null
  preApproved: { name: string } | null
}
export interface Location { id: string; name: string; is_active: boolean }
export interface Department { id: string; name: string; is_active: boolean }
export interface ShipToWorker { id: string; name: string; location: string | null; label: string }
export interface FavoriteItem { id: string; name: string; item_url: string | null; created_by: string | null; created_at: string }
export interface PreApprovedItem { id: string; name: string; item_url: string | null; quantity: number; substitution_ok: boolean; location_id: string | null; custom_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; memo: string | null; created_by: string | null; created_at: string; source_line_item_id: string | null }
export interface RequestCommentRow {
  id: string
  request_id: string
  parent_id: string | null
  line_item_id: string | null
  source: 'request' | 'approvals' | 'purchasing' | 'request_notes'
  author_id: string | null
  author_name: string
  author_email: string | null
  author_role: 'requester' | 'staff'
  body: string
  mentioned_user_ids: string[]
  created_at: string
}
export interface MentionCandidate { user_id: string; display_name: string | null; email: string | null }

export function useProcurementApi() {
  const supabase = useSupabase()
  const db = () => supabase.schema(SCHEMA)
  const ok = <T,>(res: { data: T; error: { message: string } | null }): T => { if (res.error) throw new Error(res.error.message); return res.data }

  async function listRequests(requesterId?: string, requesterEmail?: string): Promise<RequestRow[]> {
    let query = db().from(TABLES.requests).select('*, line_items(item_description, item_url)')
      .order('line_no', { ascending: true, referencedTable: 'line_items' })
      .order('updated_at', { ascending: false })
    const filters: string[] = []
    if (requesterId) filters.push(`requester_id.eq.${requesterId}`)
    if (requesterId && requesterEmail) filters.push(`and(requester_id.is.null,requester_email.eq.${requesterEmail})`)
    if (filters.length) query = query.or(filters.join(','))
    return (ok(await query) ?? []) as RequestRow[]
  }
  async function getRequest(id: string): Promise<RequestRow | null> {
    return (ok(await db().from(TABLES.requests).select('*').eq('id', id).maybeSingle()) ?? null) as RequestRow | null
  }
  async function listLineItems(requestId: string): Promise<LineItemRow[]> {
    return (ok(await db().from(TABLES.lineItems).select('*').eq('request_id', requestId).order('created_at', { ascending: true })) ?? []) as LineItemRow[]
  }
  async function listLocations(): Promise<Location[]> {
    return (ok(await db().from(TABLES.locations).select('*').eq('is_active', true).order('name')) ?? []) as Location[]
  }
  async function listDepartments(): Promise<Department[]> {
    return (ok(await db().from(TABLES.departments).select('*').eq('is_active', true).order('name')) ?? []) as Department[]
  }
  // Admin views need inactive rows too (so they can be re-activated); the active-only
  // helpers above stay as-is for the request/purchasing dropdowns.
  async function listAllLocations(): Promise<Location[]> {
    return (ok(await db().from(TABLES.locations).select('*').order('name')) ?? []) as Location[]
  }
  async function listAllDepartments(): Promise<Department[]> {
    return (ok(await db().from(TABLES.departments).select('*').order('name')) ?? []) as Department[]
  }
  async function submitRequest(notes: string, lineItems: Record<string, unknown>[]): Promise<string> {
    return ok(await db().rpc(RPCS.submit, { p_notes: notes, p_line_items: lineItems })) as string
  }
  async function submitRequestAnon(email: string, name: string | null, notes: string, lineItems: Record<string, unknown>[]): Promise<string> {
    return ok(await db().rpc(RPCS.submitAnon, { p_requester_email: email, p_requester_name: name, p_notes: notes, p_line_items: lineItems })) as string
  }
  async function decideLineItem(id: string, action: 'approved' | 'declined' | 'on_hold'): Promise<void> {
    ok(await db().rpc(RPCS.decide, { p_line_item_id: id, p_action: action }))
  }
  async function orderLineItem(id: string, f: { date_purchased?: string; eta?: string; shipping_location_id?: string | null; custom_shipping_location?: string | null; purchase_notes?: string | null }): Promise<void> {
    ok(await db().rpc(RPCS.order, { p_line_item_id: id, p_date_purchased: f.date_purchased ?? null, p_eta: f.eta ?? null, p_shipping_location_id: f.shipping_location_id ?? null, p_custom_shipping_location: f.custom_shipping_location ?? null, p_purchase_notes: f.purchase_notes ?? null }))
  }
  async function receiveLineItem(id: string): Promise<void> { ok(await db().rpc(RPCS.receive, { p_line_item_id: id })) }
  async function createPurchaseOrder(lineItemIds: string[], f: { vendor?: string | null; date_purchased?: string; eta?: string; shipping_location_id?: string | null; custom_shipping_location?: string | null; notes?: string | null }): Promise<{ id: string; po_number: string }> {
    const row = ok(await db().rpc(RPCS.createPO, { p_line_item_ids: lineItemIds, p_vendor: f.vendor ?? null, p_date_purchased: f.date_purchased ?? null, p_eta: f.eta ?? null, p_shipping_location_id: f.shipping_location_id ?? null, p_custom_shipping_location: f.custom_shipping_location ?? null, p_notes: f.notes ?? null })) as { id: string; po_number: string }
    return row
  }
  async function closePurchaseOrder(id: string): Promise<void> { ok(await db().rpc(RPCS.closePO, { p_po_id: id })) }
  async function listPurchaseOrders(status: 'open' | 'closed'): Promise<PurchaseOrderRow[]> {
    const rows = ok(await db().from(TABLES.purchaseOrders)
      .select('*, line_items(*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at))')
      .eq('status', status)
      .order('created_at', { ascending: false })) ?? []
    return (rows as unknown as (Omit<PurchaseOrderRow, 'line_items'> & { line_items: (LineItemRow & { purchase_requests: LineItemWithRequest['request'] })[] })[]).map(po => {
      const { line_items, ...rest } = po
      return { ...rest, line_items: (line_items ?? []).map(li => { const { purchase_requests, ...item } = li; return { ...item, request: purchase_requests } as LineItemWithRequest }) } as PurchaseOrderRow
    })
  }
  async function initiateReturn(id: string, f: { return_quantity: number; return_reason: string; has_packaging: boolean; wants_replacement: boolean; return_notes?: string | null }): Promise<void> {
    ok(await db().rpc(RPCS.initiateReturn, { p_line_item_id: id, p_return_quantity: f.return_quantity, p_return_reason: f.return_reason, p_has_packaging: f.has_packaging, p_wants_replacement: f.wants_replacement, p_return_notes: f.return_notes ?? null }))
  }
  async function processReturn(id: string, orderReplacement: boolean): Promise<void> { ok(await db().rpc(RPCS.processReturn, { p_line_item_id: id, p_order_replacement: orderReplacement })) }
  async function cancelLineItem(id: string): Promise<void> {
    ok(await db().rpc(RPCS.cancel, { p_line_item_id: id }))
  }

  // Fire an in-app + email notification via the app's own procurement-capture-and-notify
  // edge function. This keeps the shell's notification catalog (bell + preferences) alive
  // while sending branded HVE emails instead of the generic shell email.
  // Best-effort: never throws into the caller (a notification failure must not break the action).
  async function fireNotification(key: string, requestId?: string, lineItemIds?: string[], details?: string): Promise<void> {
    try {
      await supabase.functions.invoke('procurement-capture-and-notify', {
        body: { event: 'notification', notification_key: key, request_id: requestId, line_item_ids: lineItemIds ?? [], details: details ?? null },
      })
    } catch (e) {
      console.error('fireNotification failed:', e)
    }
  }

  async function postRequestComment(f: { request_id: string; parent_id?: string | null; line_item_id?: string | null; source: 'request' | 'approvals' | 'purchasing' | 'request_notes'; body: string; mentions?: string[] }): Promise<RequestCommentRow> {
    const row = ok(await db().rpc(RPCS.postComment, {
      p_request_id: f.request_id,
      p_parent_id: f.parent_id ?? null,
      p_line_item_id: f.line_item_id ?? null,
      p_source: f.source,
      p_body: f.body,
      p_mentions: f.mentions ?? [],
    })) as RequestCommentRow
    return row
  }

  async function listRequestComments(requestId: string): Promise<RequestCommentRow[]> {
    return (ok(await db().from(TABLES.comments).select('*').eq('request_id', requestId).order('created_at', { ascending: true })) ?? []) as RequestCommentRow[]
  }

  async function listRequestCommentsMany(requestIds: string[]): Promise<RequestCommentRow[]> {
    if (!requestIds.length) return []
    return (ok(await db().from(TABLES.comments).select('*').in('request_id', requestIds).order('created_at', { ascending: true })) ?? []) as RequestCommentRow[]
  }

  async function listMentionCandidates(requestId: string): Promise<MentionCandidate[]> {
    return (ok(await db().rpc(RPCS.mentionCandidates, { p_request_id: requestId })) ?? []) as MentionCandidate[]
  }

  // Live INSERT updates for an open request (C2 realtime). Supabase realtime delivers
  // INSERT payloads for tables in the supabase_realtime publication. If the channel
  // errors (entitlement/plan differences), onUnhealthy is called so the caller can
  // fall back to 30 s polling (spec C2 line 200 / Risk 1).
  function subscribeRequestComments(requestId: string, onInsert: (row: RequestCommentRow) => void, onUnhealthy: () => void): () => void {
    const channel = supabase
      .channel(`request_comments:${requestId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: SCHEMA, table: TABLES.comments, filter: `request_id=eq.${requestId}` },
        (payload: { new: RequestCommentRow }) => { onInsert(payload.new) },
      )
      .subscribe((status: string) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CHANNEL_UNAVAILABLE') onUnhealthy()
      })
    return () => { supabase.removeChannel(channel) }
  }

  // Fire the thread email/bell via the app's edge function. Best-effort (same contract
  // as fireNotification): never throws into the caller.
  async function fireCommentNotification(commentId: string): Promise<void> {
    try {
      await supabase.functions.invoke('procurement-capture-and-notify', {
        body: { event: 'comment_added', comment_id: commentId },
      })
    } catch (e) {
      console.error('fireCommentNotification failed:', e)
    }
  }

  async function listLineItemsByStatus(statuses: string[]): Promise<LineItemWithRequest[]> {
    const rows = ok(await db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at)')
      .in('status', statuses)
      .order('updated_at', { ascending: false })) ?? []
    return (rows as unknown as (LineItemRow & { purchase_requests: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string } })[]).map(row => {
      const { purchase_requests, ...item } = row
      return { ...item, request: purchase_requests } as LineItemWithRequest
    })
  }

  async function listAllLineItemsDetailed(includeArchived = false): Promise<LineItemDetailed[]> {
    let query = db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, request_number, requester_name, requester_email, notes, submitted_at, status), purchase_orders!po_id(po_number), locations!location_id(name), departments!department_id(name), pre_approved_items!pre_approved_item_id(name)')
      .order('created_at', { ascending: false })
    if (!includeArchived) query = query.is('archived_at', null)
    const rows = ok(await query) ?? []
    return (rows as unknown as (LineItemRow & {
      purchase_requests: { id: string; request_number: number | null; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
      purchase_orders: { po_number: string } | null
      locations: { name: string } | null
      departments: { name: string } | null
      pre_approved_items: { name: string } | null
    })[]).map(row => {
      const { purchase_requests, purchase_orders, locations, departments, pre_approved_items, ...item } = row
      return { ...item, request: purchase_requests, po: purchase_orders, location: locations, department: departments, preApproved: pre_approved_items } as LineItemDetailed
    })
  }
  // Count-only query (head:true returns no rows, just the exact count). RLS scopes it to
  // what the caller may read — all items for an admin, only their own for a requester.
  async function countLineItems(): Promise<number> {
    const res = await db().from(TABLES.lineItems).select('*', { count: 'exact', head: true }).is('archived_at', null)
    if (res.error) throw new Error(res.error.message)
    return res.count ?? 0
  }
  // Thin status-only read for the dashboard "Items by Status" chart. RLS-scoped
  // (all items for an admin, own items for a requester). Capped at 1000 rows by
  // PostgREST — acceptable for the dashboard; TODO: move to a grouped-count RPC if volume grows.
  // Thin projection of every (RLS-scoped) line item for the dashboard charts:
  // status feeds "Items by Status", location_id/custom_location feed "Items by
  // Location". One read serves both. Capped at 1000 rows by PostgREST — fine for
  // the dashboard; TODO: move to grouped-count RPCs if volume grows.
  async function listLineItemFacets(): Promise<{ status: string; location_id: string | null; custom_location: string | null }[]> {
    return (ok(await db().from(TABLES.lineItems).select('status, location_id, custom_location').is('archived_at', null)) ?? []) as { status: string; location_id: string | null; custom_location: string | null }[]
  }
  async function setLineItemComment(id: string, comment: string): Promise<void> { ok(await db().rpc(RPCS.setComment, { p_line_item_id: id, p_comment: comment })) }
  async function deleteLineItem(id: string): Promise<void> { ok(await db().rpc(RPCS.deleteItem, { p_line_item_id: id })) }
  async function archiveLineItem(id: string, archived: boolean): Promise<void> { ok(await db().rpc(RPCS.archiveItem, { p_line_item_id: id, p_archived: archived })) }

  // Resolve a set of user ids → display names via a SECURITY DEFINER RPC. The client can't read
  // other users' public.user_profiles rows (RLS: own-row + admins only), so name resolution goes
  // through app_procurement.get_user_names (scoped to procurement actors). Used to label commenters.
  async function resolveUserNames(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {}
    const res = await db().rpc(RPCS.getUserNames, { p_ids: unique })
    if (res.error) throw new Error(res.error.message)
    const map: Record<string, string> = {}
    for (const p of ((res.data ?? []) as { id: string; display_name: string | null }[])) map[p.id] = p.display_name || ''
    return map
  }

  async function createLocation(name: string): Promise<void> { ok(await db().from(TABLES.locations).insert({ name })) }
  async function createDepartment(name: string): Promise<void> { ok(await db().from(TABLES.departments).insert({ name })) }
  async function updateLocation(id: string, patch: { name?: string; is_active?: boolean }): Promise<void> { ok(await db().from(TABLES.locations).update(patch).eq('id', id)) }
  async function updateDepartment(id: string, patch: { name?: string; is_active?: boolean }): Promise<void> { ok(await db().from(TABLES.departments).update(patch).eq('id', id)) }

  async function notifyApproved(requestId: string): Promise<void> {
    try {
      await supabase.functions.invoke('procurement-capture-and-notify', { body: { event: 'approved', request_id: requestId } })
    } catch (e) {
      console.error('notifyApproved failed:', e)
    }
  }

  async function notifyStatusUpdate(requestId: string, lineItemIds: string[], event: string, details?: string): Promise<void> {
    try {
      await supabase.functions.invoke('procurement-capture-and-notify', { body: { event, request_id: requestId, line_item_ids: lineItemIds, details } })
    } catch (e) {
      console.error(`notifyStatusUpdate(${event}) failed:`, e)
    }
  }

  async function captureAndNotify(requestId: string, onlyLineItemId?: string) {
    try {
      const { data, error } = await supabase.functions.invoke('procurement-capture-and-notify', {
        body: { request_id: requestId, only_line_item_id: onlyLineItemId ?? null },
      })
      if (error) throw error
      return data as { items: { line_item_id: string; captured: boolean; error?: string }[]; email_sent: boolean; recipients: number }
    } catch (e) {
      console.error('captureAndNotify failed:', e)
      return null
    }
  }
  async function getProductImageUrl(path: string): Promise<string | null> {
    try {
      const { data } = await supabase.storage.from('product-images').createSignedUrl(path, 3600)
      return data?.signedUrl ?? null
    } catch {
      return null
    }
  }

  async function getFormattingRules(): Promise<FormatRule[]> {
    const res = await db().rpc(RPCS.getFormattingRules)
    if (res.error || !res.data) return DEFAULT_RULES
    try { const parsed = JSON.parse(res.data as string); return Array.isArray(parsed) ? (parsed as FormatRule[]) : DEFAULT_RULES } catch { return DEFAULT_RULES }
  }
  async function setFormattingRules(rules: FormatRule[]): Promise<void> {
    ok(await db().from(TABLES.config).upsert({ key: 'formatting_rules', value: JSON.stringify(rules) }, { onConflict: 'key' }))
  }

  // Fetch the active-Rippling-worker list for the Ship-to-Name dropdown via the
  // procurement-rippling-proxy edge fn (which holds the Rippling credential
  // server-side). Never throws — on failure returns [] so the UI degrades to a
  // plain text input. { refresh: true } bypasses the edge fn's 6h cache.
  async function listShipToWorkers(opts?: { refresh?: boolean }): Promise<ShipToWorker[]> {
    try {
      const { data, error } = await supabase.functions.invoke('procurement-rippling-proxy', { body: { refresh: opts?.refresh ?? false } })
      if (error) throw error
      return ((data as { workers?: ShipToWorker[] } | null)?.workers ?? []) as ShipToWorker[]
    } catch (e) {
      console.error('listShipToWorkers failed:', e)
      return []
    }
  }

  async function listFavorites(): Promise<FavoriteItem[]> {
    return (ok(await db().from(TABLES.favoriteItems).select('*').order('name')) ?? []) as FavoriteItem[]
  }
  async function addFavorite(name: string, itemUrl?: string | null): Promise<void> {
    ok(await db().from(TABLES.favoriteItems).insert({ name, item_url: itemUrl || null }))
  }
  async function removeFavorite(id: string): Promise<void> {
    ok(await db().from(TABLES.favoriteItems).delete().eq('id', id))
  }

  // Pre-approved items catalog (table from migration 033, RPCs from 034). created_by is
  // populated by the set_pre_approved_item_creator trigger; all writes go through the RPCs
  // so permission checks stay server-side.
  async function listPreApprovedItems(): Promise<PreApprovedItem[]> {
    return (ok(await db().from(TABLES.preApprovedItems).select('*').order('created_at', { ascending: false })) ?? []) as PreApprovedItem[]
  }
  // Approve a pending/on_hold line item AND upsert it into the catalog (keyed by lower(name)).
  // Returns the catalog row id.
  async function preApproveLineItem(lineItemId: string): Promise<string> {
    return ok(await db().rpc(RPCS.preApprove, { p_line_item_id: lineItemId })) as string
  }
  // Create a purchase request + line item directly from a catalog row (status 'approved',
  // pre_approved_item_id linked). `f` holds p_*-named order fields from draftToRpcPayload.
  async function orderPreApprovedItem(preApprovedItemId: string, f: Record<string, unknown>): Promise<string> {
    return ok(await db().rpc(RPCS.orderPreApproved, { p_pre_approved_id: preApprovedItemId, ...f })) as string
  }
  async function deletePreApprovedItem(id: string): Promise<void> {
    ok(await db().rpc(RPCS.deletePreApproved, { p_id: id }))
  }
  // Resolve line item ids -> "#<requestNo>-<lineNo>" refs (itemRef format) for the Records CSV
  // "Source Item" column. pre_approved_items.source_line_item_id has no FK, so it can't be
  // embedded in the query — read the rows directly (admin-only page, so full visibility is fine).
  async function lookupItemRefs(ids: string[]): Promise<Record<string, string>> {
    const unique = [...new Set(ids.filter(Boolean))]
    if (!unique.length) return {}
    const rows = ok(await db().from(TABLES.lineItems)
      .select('id, line_no, purchase_requests!request_id(request_number)')
      .in('id', unique)) ?? []
    const map: Record<string, string> = {}
    for (const r of rows as { id: string; line_no: number | null; purchase_requests: { request_number: number | null } | null }[]) {
      if (r.purchase_requests?.request_number != null) map[r.id] = formatItemRef(r.purchase_requests.request_number, r.line_no)
    }
    return map
  }

  return { listRequests, getRequest, listLineItems, listLocations, listDepartments, listAllLocations, listAllDepartments, listFavorites, addFavorite, removeFavorite, submitRequest, submitRequestAnon, decideLineItem, orderLineItem, receiveLineItem, initiateReturn, processReturn, cancelLineItem, listLineItemsByStatus, listLineItemFacets, listAllLineItemsDetailed, countLineItems, setLineItemComment, deleteLineItem, archiveLineItem, createLocation, createDepartment, updateLocation, updateDepartment, fireNotification, captureAndNotify, getProductImageUrl, notifyApproved, notifyStatusUpdate, resolveUserNames, getFormattingRules, setFormattingRules, listShipToWorkers, createPurchaseOrder, listPurchaseOrders, closePurchaseOrder, listPreApprovedItems, preApproveLineItem, orderPreApprovedItem, deletePreApprovedItem, lookupItemRefs, postRequestComment, listRequestComments, listRequestCommentsMany, listMentionCandidates, subscribeRequestComments, fireCommentNotification }
}
