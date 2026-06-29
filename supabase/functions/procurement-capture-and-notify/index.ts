import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sendSmtp } from './smtp.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const HVE_PASSWORD = Deno.env.get('NOTIFICATION_HVE_PASSWORD') ?? ''
const HVE_HOST = 'smtp-hve.office365.com'
const HVE_PORT = 587
const SCREENSHOT_URL = 'https://msr-screenshot.livelysky-4eedc56b.eastus.azurecontainerapps.io/screenshot'
const APPROVE_PERMISSION = 'apps/procurement/approvals/act'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

function toBase64(bytes: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return btoa(bin)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { request_id?: string; only_line_item_id?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const requestId = body.request_id
  if (!requestId) return json({ error: 'request_id required' }, 400)

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Load request + line items.
  const { data: request, error: reqErr } = await db.schema('app_procurement').from('purchase_requests').select('id, requester_name, requester_email, notes, submitted_at').eq('id', requestId).maybeSingle()
  if (reqErr || !request) return json({ error: 'request not found' }, 404)
  let liQuery = db.schema('app_procurement').from('line_items').select('id, item_description, item_url, quantity, product_image_path').eq('request_id', requestId)
  if (body.only_line_item_id) liQuery = liQuery.eq('id', body.only_line_item_id)
  const { data: lineItems, error: liErr } = await liQuery
  if (liErr) return json({ error: liErr.message }, 500)

  // 2. Capture screenshots (non-fatal per item).
  const secretRes = await db.rpc('get_app_secret', { p_name: 'SCREENSHOT_API_KEY' })
  if (secretRes.error) console.warn('get_app_secret(SCREENSHOT_API_KEY) failed:', secretRes.error.message)
  const apiKey = secretRes.data as string | null
  const results: { line_item_id: string; captured: boolean; error?: string }[] = []
  for (const li of lineItems ?? []) {
    if (!li.item_url || (li.product_image_path && !body.only_line_item_id)) { results.push({ line_item_id: li.id, captured: !!li.product_image_path }); continue }
    if (!apiKey) { results.push({ line_item_id: li.id, captured: false, error: 'SCREENSHOT_API_KEY not set' }); continue }
    try {
      const shot = await fetch(SCREENSHOT_URL, { method: 'POST', headers: { 'x-api-key': apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ url: li.item_url }) })
      if (!shot.ok) throw new Error(`screenshot ${shot.status}`)
      const png = new Uint8Array(await shot.arrayBuffer())
      const path = `${requestId}/${li.id}.png`
      const up = await db.storage.from('product-images').upload(path, png, { contentType: 'image/png', upsert: true })
      if (up.error) throw up.error
      await db.schema('app_procurement').from('line_items').update({ product_image_path: path }).eq('id', li.id)
      results.push({ line_item_id: li.id, captured: true })
    } catch (e) {
      results.push({ line_item_id: li.id, captured: false, error: e instanceof Error ? e.message : String(e) })
    }
  }

  // 3. Resolve approvers.
  const { data: approvers } = await db.schema('app_procurement').rpc('get_permission_holders', { p_permission: APPROVE_PERMISSION })
  const recipientRows = (approvers ?? []) as { user_id: string; email: string }[]
  const recipientEmails = recipientRows.map((r) => r.email)

  // 4. Send rich HVE email (only on full-request runs, not single-item retries).
  let emailSent = false
  if (!body.only_line_item_id && recipientEmails.length && HVE_PASSWORD) {
    const { data: settings } = await db.from('client_settings').select('key, value').in('key', ['client_name', 'portal_url', 'hve_sender_address'])
    const sMap = new Map((settings ?? []).map((s: { key: string; value: string }) => [s.key, s.value]))
    const sender = sMap.get('hve_sender_address')
    const portalUrl = sMap.get('portal_url') ?? ''
    const clientName = sMap.get('client_name') ?? ''
    if (sender) {
      // Build HTML with inline cid images for captured items.
      const images: { cid: string; contentType: string; base64: string }[] = []
      const rowsHtml: string[] = []
      for (const li of lineItems ?? []) {
        const captured = results.find((r) => r.line_item_id === li.id)?.captured
        let imgHtml = '<em>(no product image)</em>'
        if (captured && li.product_image_path) {
          const dl = await db.storage.from('product-images').download(li.product_image_path)
          if (dl.data) { const cid = `img_${li.id.replace(/-/g, '')}`; images.push({ cid, contentType: 'image/png', base64: toBase64(new Uint8Array(await dl.data.arrayBuffer())) }); imgHtml = `<img src="cid:${cid}" alt="product" style="max-width:280px;border:1px solid #ddd;border-radius:6px"/>` } else {
            console.warn(`product-images download returned no data for line item ${li.id}`)
          }
        }
        const urlHtml = li.item_url ? `<a href="${li.item_url}">${li.item_url}</a>` : '—'
        rowsHtml.push(`<tr><td style="padding:8px;vertical-align:top">${imgHtml}</td><td style="padding:8px;vertical-align:top"><strong>${li.item_description ?? 'Item'}</strong><br/>Qty: ${li.quantity}<br/>${urlHtml}</td></tr>`)
      }
      const link = `${portalUrl}/apps/procurement`
      const html = `<div style="font-family:system-ui,Arial,sans-serif"><h2>New procurement request needs approval</h2><p>Requested by ${request.requester_name ?? request.requester_email ?? 'a requester'}.${request.notes ? ` Notes: ${request.notes}` : ''}</p><table style="border-collapse:collapse">${rowsHtml.join('')}</table><p><a href="${link}">Open Approvals in the portal</a></p></div>`
      try {
        await sendSmtp(
          { host: HVE_HOST, port: HVE_PORT, fromAddress: sender, useTls: true, auth: { type: 'login', username: sender, password: HVE_PASSWORD } },
          { recipients: recipientEmails, subject: 'New procurement request needs approval', htmlBody: html, fromDisplayName: clientName ? `${clientName} Procurement` : 'Procurement', inlineImages: images },
        )
        emailSent = true
      } catch (e) { console.error('HVE send failed:', e instanceof Error ? e.message : e) }
    }
  }

  // 5. Write bell notifications for approvers (full-request runs only).
  if (!body.only_line_item_id && recipientRows.length) {
    const bellRows = recipientRows.map((r) => ({ user_id: r.user_id, event_type: 'procurement:request_submitted', title: 'New procurement request needs approval', body: `From ${request.requester_name ?? request.requester_email ?? 'a requester'}`, link: '/apps/procurement', app_slug: 'procurement' }))
    await db.from('notifications').insert(bellRows)
  }

  return json({ request_id: requestId, items: results, email_sent: emailSent, recipients: recipientEmails.length })
})
