// Builds an RFC 5322 message with a text/html part and inline (CID) image parts,
// wrapped in multipart/related so the HTML can reference cid:<id> images.
export interface MimeImage { cid: string; contentType: string; base64: string }

export function buildMimeMessage(opts: {
  fromHeader: string      // e.g. "Procurement" <procurement@x.com>
  to: string[]
  subject: string
  html: string
  images: MimeImage[]
}): string {
  const boundary = `rel_${opts.images.length}_${opts.subject.length}_${opts.to.length}`
  const CRLF = '\r\n'
  const parts: string[] = []
  parts.push(`From: ${opts.fromHeader}`)
  parts.push(`To: ${opts.to.join(', ')}`)
  parts.push(`Subject: ${opts.subject}`)
  parts.push('MIME-Version: 1.0')
  parts.push(`Content-Type: multipart/related; boundary="${boundary}"`)
  parts.push('')
  parts.push(`--${boundary}`)
  parts.push('Content-Type: text/html; charset=utf-8')
  parts.push('Content-Transfer-Encoding: 7bit')
  parts.push('')
  parts.push(opts.html)
  for (const img of opts.images) {
    parts.push(`--${boundary}`)
    parts.push(`Content-Type: ${img.contentType}`)
    parts.push('Content-Transfer-Encoding: base64')
    parts.push(`Content-ID: <${img.cid}>`)
    parts.push(`Content-Disposition: inline; filename="${img.cid}.png"`)
    parts.push('')
    // base64 wrapped at 76 chars per line
    parts.push(img.base64.replace(/(.{76})/g, `$1${CRLF}`))
  }
  parts.push(`--${boundary}--`)
  parts.push('')
  return parts.join(CRLF)
}
