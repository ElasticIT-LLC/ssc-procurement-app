// procurement-gl-classify - GL (general ledger) category auto-classification for
// procurement request forms. Body: { item_name (1-200 chars), item_url? (<=500),
// memo? (<=500) }. Reads the active gl_categories list and the Anthropic API key
// (vault secret ANTHROPIC_API_KEY, server-side only) and asks a Haiku-class model
// to pick exactly one code. ADVISORY ONLY: this function never writes to the
// database — the form submits the accepted code via the normal submit RPCs.
// verify_jwt=false: the shared-link (private) form is anonymous; guardrails are
// strict input validation + one classification per call (bounded Haiku cost).
// 200 { gl_code } | 400 { error: 'bad_request' } | 503 { error: 'classifier_unavailable' }
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
// Claude Haiku 5.5 (verified against platform.claude.com docs 2026-10-08):
// "high-volume, latency-sensitive tasks such as classification, extraction, and routing".
const ANTHROPIC_MODEL = 'claude-haiku-5-5'
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages'
const SCHEMA = 'app_procurement'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-supabase-api-version', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// normalizeGlReply — mirrors src/lib/glNormalize.ts (kept inline: the Deno
// runtime can't import app src). Keep the two copies byte-identical.
export function normalizeGlReply(raw: string, codes: string[]): string | null {
  const t = (raw ?? '').trim().replace(/^["']|["']$/g, '')
  if (!t) return null
  const hit = codes.find((c) => c.toLowerCase() === t.toLowerCase())
  return hit ?? null
}

async function getAppSecret(db: any, name: string): Promise<string | null> {
  const { data, error } = await db.rpc('get_app_secret', { p_name: name })
  if (error) { console.warn(`get_app_secret(${name}) failed:`, error.message); return null }
  return data as string | null
}

Deno.serve(async (req) => {
  try {
    return await handleRequest(req)
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e))
    console.error(`procurement-gl-classify unhandled error: ${err.message}\n${err.stack ?? ''}`)
    return json({ error: 'classifier_unavailable' }, 503)
  }
})

async function handleRequest(req: Request) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: { item_name?: unknown; item_url?: unknown; memo?: unknown }
  try { body = await req.json() } catch { return json({ error: 'bad_request' }, 400) }

  // Strict input validation (anonymous-call guardrail): bounded text in, one pick out.
  const itemName = typeof body.item_name === 'string' ? body.item_name.trim() : ''
  if (!itemName || itemName.length > 200) return json({ error: 'bad_request' }, 400)
  const itemUrl = typeof body.item_url === 'string' ? body.item_url.slice(0, 500) : null
  const memo = typeof body.memo === 'string' ? body.memo.slice(0, 500) : null

  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  const { data: cats, error: catErr } = await db.schema(SCHEMA).from('gl_categories').select('code').eq('active', true)
  if (catErr || !cats) { console.error('gl_categories read failed:', catErr?.message ?? 'empty'); return json({ error: 'classifier_unavailable' }, 503) }
  const codes = (cats as { code: string }[]).map((c) => c.code)
  if (codes.length === 0) return json({ error: 'classifier_unavailable' }, 503)

  const apiKey = await getAppSecret(db, 'ANTHROPIC_API_KEY')
  if (!apiKey) { console.error('ANTHROPIC_API_KEY vault secret not set'); return json({ error: 'classifier_unavailable' }, 503) }

  try {
    const prompt =
      `You classify procurement items into a GL (general ledger) category.\n` +
      `Choose EXACTLY ONE code from this list:\n` +
      codes.map((c, i) => `${i + 1}. ${c}`).join('\n') +
      `\n\nItem: ${itemName}` +
      (itemUrl ? `\nURL: ${itemUrl}` : '') +
      (memo ? `\nNotes: ${memo}` : '') +
      `\n\nReply with EXACTLY one code from the list, nothing else.`

    const res = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: 64, temperature: 0, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      console.error(`Anthropic API ${res.status}: ${detail.slice(0, 300)}`)
      return json({ error: 'classifier_unavailable' }, 503)
    }
    const data = (await res.json()) as { content?: { text?: string }[] }
    const reply = data.content?.[0]?.text ?? ''
    const glCode = normalizeGlReply(reply, codes)
    if (!glCode) { console.error('LLM reply matched no active code:', JSON.stringify(reply.slice(0, 200))); return json({ error: 'classifier_unavailable' }, 503) }
    return json({ gl_code: glCode })
  } catch (e) {
    console.error('classification failed:', e instanceof Error ? e.message : e)
    return json({ error: 'classifier_unavailable' }, 503)
  }
}
