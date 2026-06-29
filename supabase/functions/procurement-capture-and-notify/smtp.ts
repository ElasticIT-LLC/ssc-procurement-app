// supabase/functions/send-notification/smtp.ts
//
// Minimal SMTP submission client. Supports two auth mechanisms:
//   - AUTH LOGIN  (legacy basic, retained for local-dev mailpit)
//   - AUTH XOAUTH2 (SASL bearer token — required by M365 HVE post-GA,
//                   since Microsoft has disabled Basic Auth for SMTP)
//
// Protocol flow (RFC 5321 §3, RFC 3207 STARTTLS, RFC 7628 XOAUTH2):
//   connect → 220 greeting → EHLO → 250 caps → STARTTLS → 220 →
//   Deno.startTls → EHLO again → 250 caps → AUTH (LOGIN|XOAUTH2) →
//   235 → MAIL FROM:<from> → 250 → RCPT TO:<bcc> per recipient → 250 →
//   DATA → 354 → message + CRLF.CRLF → 250 → QUIT → 221.
//
// Bodies are sent UTF-8 8bit; TLS makes that safe and M365 accepts it.
// All recipients ride the SMTP envelope (RCPT TO) — there is no Bcc:
// header in the rendered message, so recipients can't see each other.

import { buildMimeMessage } from './mime.ts'

export type SmtpAuth =
  | { type: 'login'; username: string; password: string }
  | { type: 'xoauth2'; username: string; accessToken: string }

export interface SmtpConfig {
  host: string
  port: number
  fromAddress: string
  /** true in prod (STARTTLS), false against a local-dev mailpit. */
  useTls: boolean
  auth: SmtpAuth
}

export interface SmtpPayload {
  recipients: string[]
  subject: string
  htmlBody: string
  /** Optional display name for the From: header. When set, the From:
   *  field renders as `"<name>" <addr>` (RFC 5322 mailbox-with-name). */
  fromDisplayName?: string
  /** Inline images embedded via multipart/related; referenced from htmlBody as cid:<cid>. */
  inlineImages?: { cid: string; contentType: string; base64: string }[]
}

/** Fetch an OAuth 2.0 access token via the client_credentials grant.
 *  The scope `https://outlook.office365.com/.default` covers HVE SMTP. */
export async function fetchOAuthToken(args: {
  tenantId: string
  clientId: string
  clientSecret: string
}): Promise<string> {
  const url = `https://login.microsoftonline.com/${args.tenantId}/oauth2/v2.0/token`
  const body = new URLSearchParams({
    client_id: args.clientId,
    client_secret: args.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://outlook.office365.com/.default',
  })
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  if (!res.ok) {
    let detail = ''
    try { detail = await res.text() } catch { /* ignore */ }
    throw new Error(`OAuth token fetch failed ${res.status}: ${detail.slice(0, 500)}`)
  }
  const json = await res.json() as { access_token?: string }
  if (!json.access_token) {
    throw new Error('OAuth token response missing access_token')
  }
  return json.access_token
}

export async function sendSmtp(config: SmtpConfig, payload: SmtpPayload): Promise<void> {
  let conn: Deno.Conn = await Deno.connect({ hostname: config.host, port: config.port })
  const session = new SmtpSession(conn)
  try {
    await session.expect(220)
    await session.send(`EHLO localhost`)
    await session.expect(250)

    if (config.useTls) {
      await session.send(`STARTTLS`)
      await session.expect(220)
      const tlsConn = await Deno.startTls(conn as Deno.TcpConn, { hostname: config.host })
      conn = tlsConn
      session.upgrade(tlsConn)
      await session.send(`EHLO localhost`)
      await session.expect(250)
    }

    if (config.auth.type === 'login') {
      await session.send(`AUTH LOGIN`)
      await session.expect(334)
      await session.send(b64utf8(config.auth.username))
      await session.expect(334)
      await session.send(b64utf8(config.auth.password))
      await session.expect(235)
    } else {
      // SASL XOAUTH2 — TWO-STEP exchange (HVE rejects the single-step
      // initial-response form, even though RFC 4954 permits it).
      // 1. Send `AUTH XOAUTH2` alone.
      // 2. Server replies 334 with an empty challenge.
      // 3. Send the base64-encoded SASL string as the challenge response.
      // 4. Server replies 235 on success.
      await session.send(`AUTH XOAUTH2`)
      await session.expect(334)
      const sasl = `user=${config.auth.username}\x01auth=Bearer ${config.auth.accessToken}\x01\x01`
      await session.send(b64utf8(sasl))
      await session.expect(235)
    }

    await session.send(`MAIL FROM:<${config.fromAddress}>`)
    await session.expect(250)
    for (const rcpt of payload.recipients) {
      await session.send(`RCPT TO:<${rcpt}>`)
      await session.expect(250)
    }

    await session.send(`DATA`)
    await session.expect(354)

    let message: string
    if (payload.inlineImages?.length) {
      const formattedFrom = payload.fromDisplayName
        ? `${encodeMailboxName(payload.fromDisplayName)} <${config.fromAddress}>`
        : config.fromAddress
      message = buildMimeMessage({
        fromHeader: formattedFrom,
        to: payload.recipients,
        subject: payload.subject,
        html: payload.htmlBody,
        images: payload.inlineImages,
      })
    } else {
      message = buildMessage(config.fromAddress, payload.subject, payload.htmlBody, payload.fromDisplayName)
    }

    await session.sendRaw(message + `\r\n.\r\n`)
    await session.expect(250)

    try { await session.send(`QUIT`); await session.expect(221) } catch { /* best-effort */ }
  } finally {
    try { conn.close() } catch { /* already closed */ }
  }
}

class SmtpSession {
  private conn: Deno.Conn
  private buf = ''
  private encoder = new TextEncoder()
  private decoder = new TextDecoder()

  constructor(conn: Deno.Conn) {
    this.conn = conn
  }

  upgrade(tls: Deno.TlsConn): void {
    this.conn = tls
  }

  async send(line: string): Promise<void> {
    await this.sendRaw(line + '\r\n')
  }

  async sendRaw(text: string): Promise<void> {
    const bytes = this.encoder.encode(text)
    let offset = 0
    while (offset < bytes.length) {
      const n = await this.conn.write(bytes.subarray(offset))
      if (n === 0) throw new Error('SMTP write returned 0 (connection closed)')
      offset += n
    }
  }

  async expect(expected: number): Promise<string> {
    while (true) {
      const newlineIdx = this.buf.indexOf('\r\n')
      if (newlineIdx === -1) {
        const chunk = new Uint8Array(4096)
        const n = await this.conn.read(chunk)
        if (n === null) throw new Error('SMTP connection closed unexpectedly')
        this.buf += this.decoder.decode(chunk.subarray(0, n), { stream: true })
        continue
      }
      const line = this.buf.slice(0, newlineIdx)
      this.buf = this.buf.slice(newlineIdx + 2)
      if (line.length < 4) throw new Error(`Malformed SMTP line: "${line}"`)
      const code = Number.parseInt(line.slice(0, 3), 10)
      const sep = line[3]
      if (sep === '-') continue
      if (code !== expected) {
        throw new Error(`SMTP ${expected} expected, server replied: ${line}`)
      }
      return line
    }
  }
}

function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

export function buildMessage(from: string, subject: string, htmlBody: string, fromDisplayName?: string): string {
  const date = new Date().toUTCString()
  const messageId = `<${crypto.randomUUID()}@elasticit.com>`
  const safeSubject = /^[\x20-\x7E]*$/.test(subject)
    ? subject
    : `=?UTF-8?B?${b64utf8(subject)}?=`
  // RFC 5322 mailbox-with-name format: `"<display-name>" <addr@host>`.
  // Quote-escape any embedded `"` per the spec; non-ASCII names get
  // RFC 2047 encoded-word treatment matching the subject's path.
  const formattedFrom = fromDisplayName
    ? `${encodeMailboxName(fromDisplayName)} <${from}>`
    : from
  // Per RFC 5321 §4.5.2: any body line beginning with `.` must be prefixed
  // with another `.` to avoid being interpreted as the message terminator.
  const dotStuffed = htmlBody.replace(/^\./gm, '..')
  const headers = [
    `From: ${formattedFrom}`,
    `To: ${formattedFrom}`,
    `Subject: ${safeSubject}`,
    `Date: ${date}`,
    `Message-ID: ${messageId}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/html; charset=utf-8`,
    `Content-Transfer-Encoding: 8bit`,
  ].join('\r\n')
  const body = dotStuffed.replace(/\r?\n/g, '\r\n')
  return `${headers}\r\n\r\n${body}`
}

function encodeMailboxName(name: string): string {
  if (/^[\x20-\x7E]*$/.test(name)) {
    return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
  }
  return `=?UTF-8?B?${b64utf8(name)}?=`
}
