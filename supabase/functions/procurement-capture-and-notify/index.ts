import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { sendSmtp } from './smtp.ts'
import { buildApprovedEmail, buildSummaryEmail } from './emails.ts'

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

  let body: { request_id?: string; only_line_item_id?: string; event?: string }
  try { body = await req.json() } catch { return json({ error: 'invalid JSON' }, 400) }
  const requestId = body.request_id
  if (!requestId) return json({ error: 'request_id required' }, 400)

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  // 1. Load request + line items.
  const { data: request, error: reqErr } = await db.schema('app_procurement').from('purchase_requests').select('id, requester_name, requester_email, notes, submitted_at, approval_notified_at').eq('id', requestId).maybeSingle()
  if (reqErr || !request) return json({ error: 'request not found' }, 404)

  const event = body.event ?? 'submitted'

  // ── Approval summary flow ───────────────────────────────────────────────
  if (event === 'approved') {
    if ((request as Record<string, unknown>).approval_notified_at) return json({ event: 'approved', skipped: true, reason: 'already notified' })
    const { data: items } = await db.schema('app_procurement').from('line_items').select('id, item_description, item_url, quantity, status, admin_comment, approved_by, custom_location, custom_department, locations!location_id(name), departments!department_id(name)').eq('request_id', requestId)
    const allItems = (items ?? []) as Array<Record<string, any>>
    const deciderIds = [...new Set(allItems.map((i) => i.approved_by).filter(Boolean))]
    const deciderMap = new Map<string, string>()
    if (deciderIds.length) {
      const { data: profs } = await db.from('user_profiles').select('id, display_name, email').in('id', deciderIds)
      for (const p of (profs ?? []) as Array<{ id: string; display_name: string | null; email: string | null }>) deciderMap.set(p.id, p.display_name || p.email || '')
    }
    const approverName = deciderMap.size ? [...deciderMap.values()][0] : 'the approver'
    const { data: settings } = await db.from('client_settings').select('key, value').in('key', ['client_name', 'portal_url', 'hve_sender_address'])
    const sMap = new Map((settings ?? []).map((s: { key: string; value: string }) => [s.key, s.value]))
    const sender = sMap.get('hve_sender_address')
    const portalUrl = sMap.get('portal_url') ?? ''
    const clientName = sMap.get('client_name') ?? ''
    const { data: appRow } = await db.from('apps').select('id').eq('slug', 'procurement').maybeSingle()
    const appBase = portalUrl && appRow?.id ? `${portalUrl}/apps/${appRow.id}` : ''
    const recordsUrl = appBase ? `${appBase}/records` : ''
    const purchasingUrl = appBase ? `${appBase}/purchasing` : ''
    const requestsUrl = appBase ? `${appBase}/requests` : ''
    const STATUS: Record<string, string> = { pending: 'Pending', approved: 'Approved', declined: 'Declined', on_hold: 'On hold', ordered: 'Ordered', received: 'Received', returned: 'Returned', replacement_ordered: 'Replacement ordered' }
    const nm = (li: Record<string, any>) => li.locations?.name ?? li.custom_location ?? '—'
    const dp = (li: Record<string, any>) => li.departments?.name ?? li.custom_department ?? '—'
    const requester = request.requester_name ?? request.requester_email ?? 'a requester'
    let purchaserEmailed = false
    let requesterEmailed = false
    if (sender && HVE_PASSWORD) {
      const approved = allItems.filter((i) => i.status === 'approved')
      const { data: purchasers } = await db.schema('app_procurement').rpc('get_permission_holders', { p_permission: 'apps/procurement/purchasing/manage' })
      const purchaserEmails = ((purchasers ?? []) as Array<{ email: string }>).map((p) => p.email)
      if (approved.length && purchaserEmails.length) {
        const html = buildApprovedEmail({ requester, approverName, recordsUrl, purchasingUrl, clientName, items: approved.map((i) => ({ name: i.item_description ?? 'Item', qty: String(i.quantity), dept: dp(i), location: nm(i), approvedBy: deciderMap.get(i.approved_by) ?? '', url: i.item_url ?? null })) })
        try { await sendSmtp({ host: HVE_HOST, port: HVE_PORT, fromAddress: sender, useTls: true, auth: { type: 'login', username: sender, password: HVE_PASSWORD } }, { recipients: purchaserEmails, subject: 'Approved Procurement Request', htmlBody: html, fromDisplayName: clientName ? `${clientName} Procurement` : 'Procurement' }); purchaserEmailed = true } catch (e) { console.error('purchaser email failed:', e instanceof Error ? e.message : e) }
      }
      if (request.requester_email) {
        const html = buildSummaryEmail({ clientName, approverName, items: allItems.map((i) => ({ name: i.item_description ?? 'Item', status: STATUS[i.status] ?? i.status, comments: i.admin_comment ?? '', decidedBy: deciderMap.get(i.approved_by) ?? '', returnUrl: requestsUrl, canReturn: ['approved', 'ordered', 'received'].includes(i.status) })) })
        try { await sendSmtp({ host: HVE_HOST, port: HVE_PORT, fromAddress: sender, useTls: true, auth: { type: 'login', username: sender, password: HVE_PASSWORD } }, { recipients: [request.requester_email], subject: 'Procurement Request Summary', htmlBody: html, fromDisplayName: clientName ? `${clientName} Procurement` : 'Procurement' }); requesterEmailed = true } catch (e) { console.error('requester email failed:', e instanceof Error ? e.message : e) }
      }
    }
    await db.schema('app_procurement').from('purchase_requests').update({ approval_notified_at: new Date().toISOString() }).eq('id', requestId)
    return json({ event: 'approved', purchaser_emailed: purchaserEmailed, requester_emailed: requesterEmailed, items: allItems.length })
  }

  let liQuery = db.schema('app_procurement').from('line_items').select('id, item_description, item_url, quantity, product_image_path, custom_location, custom_department, locations!location_id(name), departments!department_id(name)').eq('request_id', requestId)
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
      // Build a branded HTML email with inline (CID) product screenshots.
      const GREEN = '#2b6450'
      const images: { cid: string; contentType: string; base64: string }[] = []
      const rowsHtml: string[] = []
      for (const li of lineItems ?? []) {
        const captured = results.find((r) => r.line_item_id === li.id)?.captured
        let imgHtml = '<span style="color:#9aa5ad;font-size:12px">No image</span>'
        if (captured && li.product_image_path) {
          const dl = await db.storage.from('product-images').download(li.product_image_path)
          if (dl.data) { const cid = `img_${li.id.replace(/-/g, '')}`; images.push({ cid, contentType: 'image/png', base64: toBase64(new Uint8Array(await dl.data.arrayBuffer())) }); imgHtml = `<img src="cid:${cid}" alt="product" style="width:96px;height:auto;border:1px solid #e4e7ea;border-radius:6px;display:block"/>` } else {
            console.warn(`product-images download returned no data for line item ${li.id}`)
          }
        }
        const row = li as Record<string, unknown> & { locations?: { name?: string } | null; departments?: { name?: string } | null }
        const loc = row.locations?.name ?? li.custom_location ?? '—'
        const dept = row.departments?.name ?? li.custom_department ?? '—'
        const itemName = li.item_description ?? 'Item'
        const nameCell = li.item_url ? `<a href="${li.item_url}" style="color:${GREEN};font-weight:600;text-decoration:none">${itemName}</a>` : `<strong>${itemName}</strong>`
        const td = 'padding:10px 12px;border-bottom:1px solid #e4e7ea;font-size:14px;color:#36414d;vertical-align:top'
        rowsHtml.push(`<tr><td style="${td}">${imgHtml}</td><td style="${td}">${nameCell}</td><td style="${td};text-align:center">${li.quantity}</td><td style="${td}">${dept}</td><td style="${td}">${loc}</td></tr>`)
      }
      const thL = 'padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#1f4739;background:#dbf0e9;border-bottom:2px solid #b8e0d2'
      const thC = thL.replace('text-align:left', 'text-align:center')
      const requester = request.requester_name ?? request.requester_email ?? 'a requester'
      const { data: appRow } = await db.from('apps').select('id').eq('slug', 'procurement').maybeSingle()
      const appBase = portalUrl && appRow?.id ? `${portalUrl}/apps/${appRow.id}` : ''
      const approvalsUrl = appBase ? `${appBase}/approvals` : ''
      const btn = approvalsUrl ? `<table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 8px auto"><tr><td align="center"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${approvalsUrl}" style="height:44px;v-text-anchor:middle;width:220px;" arcsize="12%" strokecolor="${GREEN}" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;">Review &amp; Approve</center></v:roundrect><![endif]--><a href="${approvalsUrl}" target="_blank" style="display:inline-block;background-color:${GREEN};color:#ffffff;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;border:1px solid ${GREEN}">Review &amp; Approve</a></td></tr></table>` : ''
      const html = `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><body style="margin:0;padding:0"><table cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;background-color:#f4f6f8;padding:24px"><tr><td align="center"><table cellpadding="0" cellspacing="0" width="620" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.08)"><tr><td style="padding:20px;background:${GREEN};color:#ffffff;text-align:left"><h2 style="margin:0;font-size:18px;font-weight:600">Purchase Request Submitted</h2><div style="font-size:12px;opacity:0.95">Action required: Review &amp; Approve</div></td></tr><tr><td style="padding:20px;color:#333333;font-size:14px;line-height:1.5"><p style="margin:0 0 16px 0"><strong>${requester}</strong> has submitted a new purchase request that requires your review.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Product</th><th style="${thL}">Item</th><th style="${thC}">Qty</th><th style="${thL}">Department</th><th style="${thL}">Location</th></tr>${rowsHtml.join('')}</table><p style="margin:0 0 20px 0">Please click the button below to review and take action on this request.</p>${btn}<p style="margin:14px 0 0 0;font-size:12px;color:#555">If you've already reviewed this request, you can disregard this message.</p></td></tr><tr><td style="padding:12px 20px;background:#f7f9fb"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="left" style="font-size:12px;color:#666">Procurement · ${clientName || 'Mainspring Recovery'}</td><td align="right" style="font-size:12px;color:#666">Automated Notification</td></tr></table></td></tr></table></td></tr></table></body></html>`
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
