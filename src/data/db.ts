import { useSupabase } from '@elasticit-llc/app-bridge'
import type { LineItemStatus, RequestStatus } from '../lib/constants'
import { DEFAULT_RULES, type FormatRule } from '../formatting/rules'

const SCHEMA = 'app_procurement'
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments', config: '_config', purchaseOrders: 'purchase_orders' } as const
const RPCS = { submit: 'submit_request', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return', setComment: 'set_line_item_comment', deleteItem: 'delete_line_item', cancel: 'cancel_line_item', getUserNames: 'get_user_names', getFormattingRules: 'get_formatting_rules', createPO: 'create_purchase_order', closePO: 'close_purchase_order' } as const

export interface RequestRow { id: string; requester_id: string | null; requester_name: string | null; requester_email: string | null; requester_type: string; status: RequestStatus; notes: string | null; submitted_at: string; updated_at: string; request_number: number | null; line_items?: { item_description: string | null }[] }
export interface LineItemRow { id: string; request_id: string; item_description: string | null; item_url: string | null; memo: string | null; quantity: number; status: LineItemStatus; location_id: string | null; custom_location: string | null; department_id: string | null; custom_department: string | null; date_needed: string | null; eta: string | null; admin_comment: string | null; commented_by: string | null; commented_at: string | null; product_image_path: string | null; return_reason: string | null; return_quantity: number | null; wants_replacement: boolean | null; return_notes: string | null; return_date: string | null; created_at: string; line_no: number | null; return_processed_at: string | null; po_id: string | null }
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
  request: { requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
  location: { name: string } | null
  department: { name: string } | null
}
export interface Location { id: string; name: string; is_active: boolean }
export interface Department { id: string; name: string; is_active: boolean }
export interface ShipToWorker { id: string; name: string; location: string | null; label: string }

export function useProcurementApi() {
  const supabase = useSupabase()
  const db = () => supabase.schema(SCHEMA)
  const ok = <T,>(res: { data: T; error: { message: string } | null }): T => { if (res.error) throw new Error(res.error.message); return res.data }

  async function listRequests(): Promise<RequestRow[]> {
    return (ok(await db().from(TABLES.requests).select('*, line_items(item_description)')
      .order('line_no', { ascending: true, referencedTable: 'line_items' })
      .order('updated_at', { ascending: false })) ?? []) as RequestRow[]
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

  // Fire an in-app + email notification via the shell's send-notification function.
  // Best-effort: never throws into the caller (a notification failure must not break the action).
  async function fireNotification(key: string, details?: string): Promise<void> {
    try {
      await supabase.functions.invoke('send-notification', {
        body: { event_type: `procurement:${key}`, app_slug: 'procurement', app_name: 'Procurement', details: details ?? null },
      })
    } catch (e) {
      console.error('send-notification failed:', e)
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

  async function listAllLineItemsDetailed(): Promise<LineItemDetailed[]> {
    const rows = ok(await db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(requester_name, requester_email, notes, submitted_at, status), locations!location_id(name), departments!department_id(name)')
      .order('created_at', { ascending: false })) ?? []
    return (rows as unknown as (LineItemRow & {
      purchase_requests: { requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string; status: RequestStatus }
      locations: { name: string } | null
      departments: { name: string } | null
    })[]).map(row => {
      const { purchase_requests, locations, departments, ...item } = row
      return { ...item, request: purchase_requests, location: locations, department: departments } as LineItemDetailed
    })
  }
  // Count-only query (head:true returns no rows, just the exact count). RLS scopes it to
  // what the caller may read — all items for an admin, only their own for a requester.
  async function countLineItems(): Promise<number> {
    const res = await db().from(TABLES.lineItems).select('*', { count: 'exact', head: true })
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
    return (ok(await db().from(TABLES.lineItems).select('status, location_id, custom_location')) ?? []) as { status: string; location_id: string | null; custom_location: string | null }[]
  }
  async function setLineItemComment(id: string, comment: string): Promise<void> { ok(await db().rpc(RPCS.setComment, { p_line_item_id: id, p_comment: comment })) }
  async function deleteLineItem(id: string): Promise<void> { ok(await db().rpc(RPCS.deleteItem, { p_line_item_id: id })) }

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

  return { listRequests, getRequest, listLineItems, listLocations, listDepartments, listAllLocations, listAllDepartments, submitRequest, decideLineItem, orderLineItem, receiveLineItem, initiateReturn, processReturn, cancelLineItem, listLineItemsByStatus, listLineItemFacets, listAllLineItemsDetailed, countLineItems, setLineItemComment, deleteLineItem, createLocation, createDepartment, updateLocation, updateDepartment, fireNotification, captureAndNotify, getProductImageUrl, notifyApproved, resolveUserNames, getFormattingRules, setFormattingRules, listShipToWorkers, createPurchaseOrder, listPurchaseOrders, closePurchaseOrder }
}
