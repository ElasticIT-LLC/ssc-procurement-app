import { useSupabase } from '@elasticit-llc/app-bridge'
import type { LineItemStatus, RequestStatus } from '../lib/constants'

const SCHEMA = 'app_procurement'
const TABLES = { requests: 'purchase_requests', lineItems: 'line_items', locations: 'locations', departments: 'departments' } as const
const RPCS = { submit: 'submit_request', decide: 'decide_line_item', order: 'order_line_item', receive: 'receive_line_item', initiateReturn: 'initiate_return', processReturn: 'process_return' } as const

export interface RequestRow { id: string; requester_id: string | null; requester_name: string | null; requester_email: string | null; requester_type: string; status: RequestStatus; notes: string | null; submitted_at: string; updated_at: string }
export interface LineItemRow { id: string; request_id: string; item_description: string | null; item_url: string | null; memo: string | null; quantity: number; status: LineItemStatus; location_id: string | null; department_id: string | null; date_needed: string | null; eta: string | null; product_image_path: string | null; return_reason: string | null; return_quantity: number | null; wants_replacement: boolean | null; return_notes: string | null }
export interface LineItemWithRequest extends LineItemRow {
  request: {
    id: string
    requester_name: string | null
    requester_email: string | null
    notes: string | null
    submitted_at: string
  }
}
export interface Location { id: string; name: string; is_active: boolean }
export interface Department { id: string; name: string; is_active: boolean }

export function useProcurementApi() {
  const supabase = useSupabase()
  const db = () => supabase.schema(SCHEMA)
  const ok = <T,>(res: { data: T; error: { message: string } | null }): T => { if (res.error) throw new Error(res.error.message); return res.data }

  async function listRequests(): Promise<RequestRow[]> {
    return (ok(await db().from(TABLES.requests).select('*').order('updated_at', { ascending: false })) ?? []) as RequestRow[]
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
  async function initiateReturn(id: string, f: { return_quantity: number; return_reason: string; has_packaging: boolean; wants_replacement: boolean; return_notes?: string | null }): Promise<void> {
    ok(await db().rpc(RPCS.initiateReturn, { p_line_item_id: id, p_return_quantity: f.return_quantity, p_return_reason: f.return_reason, p_has_packaging: f.has_packaging, p_wants_replacement: f.wants_replacement, p_return_notes: f.return_notes ?? null }))
  }
  async function processReturn(id: string, orderReplacement: boolean): Promise<void> { ok(await db().rpc(RPCS.processReturn, { p_line_item_id: id, p_order_replacement: orderReplacement })) }

  async function listLineItemsByStatus(statuses: string[]): Promise<LineItemWithRequest[]> {
    const rows = ok(await db().from(TABLES.lineItems)
      .select('*, purchase_requests!request_id(id, requester_name, requester_email, notes, submitted_at)')
      .in('status', statuses)
      .order('updated_at', { ascending: false })) ?? []
    return (rows as unknown as (LineItemRow & { purchase_requests: { id: string; requester_name: string | null; requester_email: string | null; notes: string | null; submitted_at: string } })[]).map(row => {
      const { purchase_requests, ...item } = row
      return { ...item, request: purchase_requests } as LineItemWithRequest
    })
  }

  async function createLocation(name: string): Promise<void> { ok(await db().from(TABLES.locations).insert({ name })) }
  async function createDepartment(name: string): Promise<void> { ok(await db().from(TABLES.departments).insert({ name })) }

  return { listRequests, getRequest, listLineItems, listLocations, listDepartments, submitRequest, decideLineItem, orderLineItem, receiveLineItem, initiateReturn, processReturn, listLineItemsByStatus, createLocation, createDepartment }
}
