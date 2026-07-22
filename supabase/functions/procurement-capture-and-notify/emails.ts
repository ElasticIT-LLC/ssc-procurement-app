// Branded HVE email templates for the procurement approval flow (Mainspring green).
const GREEN = '#2b6450'

function shell(headerTitle: string, headerSub: string, bodyInner: string, clientName: string): string {
  return `<html xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office"><body style="margin:0;padding:0"><table cellpadding="0" cellspacing="0" width="100%" style="font-family:Arial,sans-serif;background-color:#f4f6f8;padding:24px"><tr><td align="center"><table cellpadding="0" cellspacing="0" width="620" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 6px rgba(0,0,0,0.08)"><tr><td style="padding:20px;background:${GREEN};color:#ffffff;text-align:left"><h2 style="margin:0;font-size:18px;font-weight:600">${headerTitle}</h2><div style="font-size:12px;opacity:0.95">${headerSub}</div></td></tr><tr><td style="padding:20px;color:#333333;font-size:14px;line-height:1.5">${bodyInner}</td></tr><tr><td style="padding:12px 20px;background:#f7f9fb"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="left" style="font-size:12px;color:#666">Procurement · ${clientName || 'Mainspring Recovery'}</td><td align="right" style="font-size:12px;color:#666">Automated Notification</td></tr></table></td></tr></table></td></tr></table></body></html>`
}

const thL = 'padding:10px 12px;text-align:left;font-size:12px;font-weight:700;color:#1f4739;background:#dbf0e9;border-bottom:2px solid #b8e0d2'
const thC = thL.replace('text-align:left', 'text-align:center')
const td = 'padding:10px 12px;border-bottom:1px solid #e4e7ea;font-size:14px;color:#36414d;vertical-align:top'

function vmlButton(url: string, text: string, width: string = '220px'): string {
  if (!url) return ''
  return `<table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 8px auto"><tr><td align="center"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${url}" style="height:44px;v-text-anchor:middle;width:${width};" arcsize="12%" strokecolor="${GREEN}" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:15px;font-weight:600;">${text}</center></v:roundrect><![endif]--><a href="${url}" target="_blank" style="display:inline-block;background-color:${GREEN};color:#ffffff;padding:12px 24px;border-radius:6px;font-size:15px;font-weight:600;text-decoration:none;border:1px solid ${GREEN}">${text}</a></td></tr></table>`
}

export interface ApprovedItem { name: string; qty: string; dept: string; location: string; approvedBy: string; url: string | null; status: string }
export function buildApprovedEmail(o: { requester: string; items: ApprovedItem[]; recordsUrl: string; purchasingUrl: string; clientName: string; approverName: string }): string {
  const rows = o.items.map((it) => {
    const nameCell = it.url ? `<a href="${it.url}" target="_blank" style="color:${GREEN};font-weight:600;text-decoration:none">${it.name}</a>` : `<strong>${it.name}</strong>`
    return `<tr><td style="${td}">${nameCell}</td><td style="${td};text-align:center">${it.qty}</td><td style="${td}">${it.status}</td><td style="${td}">${it.dept}</td><td style="${td}">${it.location}</td><td style="${td}">${it.approvedBy}</td></tr>`
  }).join('')
  const body = `<p style="margin:0 0 16px 0"><strong>${o.requester}</strong> has had a procurement request with approved items.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th><th style="${thC}">Qty</th><th style="${thL}">Status</th><th style="${thL}">Department</th><th style="${thL}">Location</th><th style="${thL}">Approved By</th></tr>${rows}</table>${purchasingBtn(o.purchasingUrl, 'Set ETA & Shipping')}${o.recordsUrl ? `<p style="margin:0 0 12px 0">You can view the complete item list here:</p><p style="margin:0 0 16px 0"><a href="${o.recordsUrl}" target="_blank" style="color:${GREEN};text-decoration:none;font-weight:600">View full item list</a></p>` : ''}<p style="margin:14px 0 0 0;font-size:12px;color:#555">If you've already reviewed this request, you can disregard this message.</p>`
  return shell('Approved Procurement Request', 'Items approved for purchase', body, o.clientName)
}

export interface SummaryItem { name: string; status: string; comments: string; decidedBy: string; returnUrl: string | null; canReturn: boolean }
export function buildSummaryEmail(o: { items: SummaryItem[]; clientName: string; approverName: string }): string {
  const rows = o.items.map((it) => {
    const nameCell = `<strong>${it.name}</strong>`
    const actionCell = it.canReturn && it.returnUrl
      ? `<table cellpadding="0" cellspacing="0" role="presentation" align="center"><tr><td align="center"><!--[if mso]><v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${it.returnUrl}" style="height:28px;v-text-anchor:middle;width:80px;" arcsize="10%" strokecolor="${GREEN}" fillcolor="${GREEN}"><w:anchorlock/><center style="color:#ffffff;font-family:Arial,sans-serif;font-size:12px;font-weight:600;">Return</center></v:roundrect><![endif]--><a href="${it.returnUrl}" target="_blank" style="display:inline-block;background-color:${GREEN};color:#ffffff;padding:4px 12px;border-radius:4px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid ${GREEN}">Return</a></td></tr></table>`
      : '—'
    return `<tr><td style="${td}">${nameCell}</td><td style="${td}">${it.status}</td><td style="${td};word-break:break-word">${it.comments}</td><td style="${td}">${it.decidedBy}</td><td style="${td};text-align:center">${actionCell}</td></tr>`
  }).join('')
  const body = `<p style="margin:0 0 16px 0">Kindly review your request summary. For any denied requests, please submit a new request addressing the approver's comments.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th><th style="${thL}">Status</th><th style="${thL}">Comments</th><th style="${thL}">Approved/Denied By</th><th style="${thC}">Action</th></tr>${rows}</table><p style="margin:14px 0 0 0;font-size:12px;color:#555">For any updates or clarifications, please reach out to ${o.approverName || 'the approver'}.</p>`
  return shell('Request Summary', 'Overview of submitted items', body, o.clientName)
}

export interface ConfirmationItem { name: string; qty: string; dept: string; location: string }
export function buildRequesterConfirmation(o: { requestNumber: string | number | null; items: ConfirmationItem[]; clientName: string; requestsUrl: string }): string {
  const number = o.requestNumber != null ? ` #${o.requestNumber}` : ''
  const rows = o.items.map((it) => `<tr><td style="${td}">${it.name}</td><td style="${td};text-align:center">${it.qty}</td><td style="${td}">${it.dept}</td><td style="${td}">${it.location}</td></tr>`).join('')
  const body = `<p style="margin:0 0 16px 0">Your procurement request has been submitted.${number}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th><th style="${thC}">Qty</th><th style="${thL}">Department</th><th style="${thL}">Location</th></tr>${rows}</table><p style="margin:0 0 20px 0">Please click the button below to track your request.</p>${vmlButton(o.requestsUrl, 'View Your Request')}<p style="margin:14px 0 0 0;font-size:12px;color:#555">You will receive a notification once an approver reviews your request.</p>`
  return shell('Procurement Request Submitted', `Request${number} — items pending review`, body, o.clientName)
}

export interface ReturnNotificationItem { name: string; qty: string; reason: string; wantsReplacement: boolean }
export function buildReturnNotificationEmail(o: { requester: string; items: ReturnNotificationItem[]; returnsUrl: string; clientName: string }): string {
  const rows = o.items.map((it) => `<tr><td style="${td}">${it.name}</td><td style="${td};text-align:center">${it.qty}</td><td style="${td}">${it.reason || '—'}</td><td style="${td}">${it.wantsReplacement ? 'Yes' : 'No'}</td></tr>`).join('')
  const body = `<p style="margin:0 0 16px 0"><strong>${o.requester}</strong> has returned the following items for replacement.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th><th style="${thC}">Qty</th><th style="${thL}">Return Reason</th><th style="${thL}">Wants Replacement</th></tr>${rows}</table><p style="margin:0 0 20px 0">Please click the button below to process returns.</p>${vmlButton(o.returnsUrl, 'Process Returns')}<p style="margin:14px 0 0 0;font-size:12px;color:#555">If you've already processed these returns, you can disregard this message.</p>`
  return shell(`Items Returned from ${o.requester}`, 'Return items for replacement', body, o.clientName)
}

export interface ItemOrderedItem { name: string; qty: string; eta: string; shippingLocation: string }
export function buildItemOrderedEmail(o: { item: ItemOrderedItem; purchaserName: string; clientName: string; requestsUrl: string }): string {
  const body = `<p style="margin:0 0 16px 0">Your item has been ordered by the purchasing team.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th><th style="${thC}">Qty</th><th style="${thL}">ETA</th><th style="${thL}">Shipping Location</th></tr><tr><td style="${td}">${o.item.name}</td><td style="${td};text-align:center">${o.item.qty}</td><td style="${td}">${o.item.eta || '—'}</td><td style="${td}">${o.item.shippingLocation || '—'}</td></tr></table><p style="margin:0 0 20px 0">Ordered by <strong>${o.purchaserName}</strong>.</p>${vmlButton(o.requestsUrl, 'View Your Requests')}<p style="margin:14px 0 0 0;font-size:12px;color:#555">You will receive another notification when your item is received.</p>`
  return shell('Item Ordered', 'Your procurement item has been ordered', body, o.clientName)
}

export interface ItemCancelledItem { name: string }
export function buildItemCancelledEmail(o: { item: ItemCancelledItem; cancellerName: string; clientName: string; requestsUrl: string }): string {
  const body = `<p style="margin:0 0 16px 0">The following item has been cancelled by the purchasing team.</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid #e4e7ea;margin:0 0 20px 0"><tr><th style="${thL}">Item</th></tr><tr><td style="${td}">${o.item.name}</td></tr></table><p style="margin:0 0 20px 0">Cancelled by <strong>${o.cancellerName}</strong>.</p>${vmlButton(o.requestsUrl, 'View Your Requests')}<p style="margin:14px 0 0 0;font-size:12px;color:#555">If you need to request this item again, you can submit a new request.</p>`
  return shell('Item Cancelled', 'Your procurement item has been cancelled', body, o.clientName)
}

export interface NotificationEmailParams { title: string; body: string; linkUrl: string; linkText: string; clientName: string }
export function buildNotificationEmail(o: NotificationEmailParams): string {
  const body = `<p style="margin:0 0 16px 0">${o.body}</p>${o.linkUrl ? vmlButton(o.linkUrl, o.linkText) : ''}<p style="margin:14px 0 0 0;font-size:12px;color:#555">This is an automated notification from Procurement.</p>`
  return shell(o.title, 'Notification', body, o.clientName)
}

function purchasingBtn(url: string, text: string): string {
  if (!url) return ''
  return `<p style="margin:0 0 20px 0">Please click the button below to review and take action on this request.</p>${vmlButton(url, text)}`
}
