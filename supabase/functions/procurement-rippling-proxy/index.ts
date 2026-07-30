// procurement-rippling-proxy — returns the active-Rippling-worker list for the
// Ship-to-Name dropdown. Reads procurement's Rippling API-key credential from the
// vault server-side (the key never reaches the browser), fetches /workers +
// /work-locations from rest.ripplingapis.com, keeps status=ACTIVE, joins location
// names, and caches the compact list in app_procurement._config for 6h.
// verify_jwt=false at the platform gate (shell uses Entra ES256 tokens); the
// function authenticates the caller itself. Any authenticated portal user. Body: { refresh?: boolean }.
import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const CREDENTIAL_ENCRYPTION_KEY = Deno.env.get('CREDENTIAL_ENCRYPTION_KEY') ?? ''
const RIPPLING_BASE = 'https://rest.ripplingapis.com'
const WORKER_EXPAND = 'user'
const CACHE_TTL_MS = 6 * 60 * 60 * 1000
const SCHEMA = 'app_procurement'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } })

// ── Credential Vault AES-256-GCM decrypt (matches the credential-vault edge fn) ──
async function getCredentialKey(): Promise<CryptoKey> {
  if (!CREDENTIAL_ENCRYPTION_KEY) throw new Error('CREDENTIAL_ENCRYPTION_KEY env var not set')
  const keyBytes = new Uint8Array(CREDENTIAL_ENCRYPTION_KEY.match(/.{2}/g)!.map((b) => parseInt(b, 16)))
  return crypto.subtle.importKey('raw', keyBytes, 'AES-GCM', false, ['decrypt'])
}
async function decryptCredential(encoded: string): Promise<string> {
  const key = await getCredentialKey()
  const combined = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0))
  const iv = combined.slice(0, 12)
  const ciphertext = combined.slice(12)
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  return new TextDecoder().decode(plaintext)
}
async function getRipplingToken(db: ReturnType<typeof createClient>, appId: string): Promise<string> {
  const { data: cred, error } = await db.from('credentials').select('credential_type, encrypted_data').eq('app_id', appId).in('credential_type', ['bearer', 'api_key']).limit(1).maybeSingle()
  if (error) throw new Error(`credential lookup: ${error.message}`)
  if (!cred) throw new Error('No Rippling (bearer/api_key) credential linked to procurement')
  const parsed = JSON.parse(await decryptCredential((cred as { encrypted_data: string }).encrypted_data)) as Record<string, unknown>
  let token = (parsed.token ?? parsed.value ?? parsed.access_token) as string | undefined
  if (!token) throw new Error('decrypted credential has no token/value field')
  if (token.toLowerCase().startsWith('bearer ')) token = token.slice(7).trim()
  return token
}

// ── Rippling paginated fetch with backoff on 429/5xx (per overtime-sync) ──
async function fetchWithRetry(url: string, token: string): Promise<Response> {
  const BACKOFF = [5_000, 20_000, 60_000]
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(120_000) })
      if ((res.status === 429 || res.status >= 500) && attempt < 3) { lastErr = new Error(`HTTP ${res.status}`); await new Promise((r) => setTimeout(r, BACKOFF[attempt - 1])); continue }
      return res
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e))
      if (attempt < 3) await new Promise((r) => setTimeout(r, BACKOFF[attempt - 1]))
    }
  }
  throw lastErr ?? new Error(`failed to fetch ${url}`)
}
async function fetchAllPages(path: string, token: string): Promise<Record<string, unknown>[]> {
  let url: string | null = `${RIPPLING_BASE}${path}`
  const all: Record<string, unknown>[] = []
  while (url) {
    const res = await fetchWithRetry(url, token)
    if (!res.ok) { const body = await res.text().catch(() => ''); throw new Error(`Rippling ${path} ${res.status}: ${body.slice(0, 200)}`) }
    const data = await res.json() as { results?: Record<string, unknown>[]; next_link?: string | null }
    if (Array.isArray(data.results)) all.push(...data.results)
    url = data.next_link ?? null
  }
  return all
}

interface ShipToWorker { id: string; name: string; location: string | null; label: string }

function toProperCase(s: string): string {
  return s.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase())
}

function buildWorkers(workerRaw: Record<string, unknown>[], locMap: Map<string, string>): ShipToWorker[] {
  const out: ShipToWorker[] = []
  for (const w of workerRaw) {
    if (String(w.status ?? '').toUpperCase() !== 'ACTIVE') continue
    const id = typeof w.id === 'string' ? w.id : null
    if (!id) continue
    const user = w.user && typeof w.user === 'object' ? w.user as Record<string, unknown> : null
    const uname = user && user.name && typeof user.name === 'object' ? user.name as Record<string, unknown> : null
    const rawName = (user && typeof user.display_name === 'string' ? user.display_name : null)
      ?? (uname && typeof uname.formatted === 'string' ? uname.formatted : null)
      ?? (typeof w.work_email === 'string' ? w.work_email : null)
      ?? 'Unknown'
    const name = toProperCase(rawName)
    const loc = w.location && typeof w.location === 'object' ? w.location as Record<string, unknown> : null
    const wlId = loc && typeof loc.work_location_id === 'string' ? loc.work_location_id : null
    const location = wlId ? (locMap.get(wlId) ?? null) : null
    out.push({ id, name, location, label: location ? `${name} (${location})` : name })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  let body: { refresh?: boolean } = {}
  try { body = await req.json() } catch { /* no body → defaults */ }
  const refresh = body?.refresh === true
  const db = createClient(SUPABASE_URL, SERVICE_KEY)

  // Auth: the platform verify_jwt gate is off (the shell uses Entra ES256 tokens
  // that Supabase's HS256 gate can't verify), so authenticate the caller here.
  // Any authenticated portal user may fetch the worker list.
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Missing Authorization header', workers: [] }, 401)
  const { data: { user } } = await db.auth.getUser(authHeader.slice('Bearer '.length))
  if (!user) return json({ error: 'Invalid token', workers: [] }, 401)

  const { data: appRow } = await db.from('apps').select('id').eq('slug', 'procurement').maybeSingle()
  if (!appRow) return json({ error: 'procurement app not found', workers: [] }, 500)
  const appId = (appRow as { id: string }).id

  // Cache read.
  const { data: cfg } = await db.schema(SCHEMA).from('_config').select('key, value').in('key', ['rippling_workers_cache', 'rippling_workers_cached_at'])
  const cMap = new Map(((cfg ?? []) as { key: string; value: string }[]).map((r) => [r.key, r.value]))
  const cachedAt = cMap.get('rippling_workers_cached_at') ?? null
  const cachedJson = cMap.get('rippling_workers_cache') ?? null
  const cacheFresh = cachedAt && (Date.now() - new Date(cachedAt).getTime() < CACHE_TTL_MS)
  if (!refresh && cacheFresh && cachedJson) {
    try { return json({ workers: JSON.parse(cachedJson), cached: true, cached_at: cachedAt }) } catch { /* fall through */ }
  }

  // Live fetch.
  try {
    const token = await getRipplingToken(db, appId)
    const locRaw = await fetchAllPages('/work-locations', token)
    const locMap = new Map<string, string>()
    for (const l of locRaw) { if (typeof l.id === 'string' && typeof l.name === 'string') locMap.set(l.id, l.name) }
    const workerRaw = await fetchAllPages(`/workers?expand=${encodeURIComponent(WORKER_EXPAND)}`, token)
    const workers = buildWorkers(workerRaw, locMap)
    const now = new Date().toISOString()
    await db.schema(SCHEMA).from('_config').upsert([
      { key: 'rippling_workers_cache', value: JSON.stringify(workers) },
      { key: 'rippling_workers_cached_at', value: now },
    ], { onConflict: 'key' })
    return json({ workers, cached: false, cached_at: now })
  } catch (e) {
    if (cachedJson) { try { return json({ workers: JSON.parse(cachedJson), cached: true, cached_at: cachedAt, stale: true }) } catch { /* ignore */ } }
    console.error('rippling proxy failed:', e instanceof Error ? e.message : e)
    return json({ error: e instanceof Error ? e.message : 'rippling fetch failed', workers: [] }, 502)
  }
})
