// Normalize an LLM classification reply to one of the active GL category codes.
// Mirrored inline in supabase/functions/procurement-gl-classify/index.ts (the Deno
// runtime can't import app src) — keep the two copies byte-identical.
export function normalizeGlReply(raw: string, codes: string[]): string | null {
  const t = (raw ?? '').trim().replace(/^["']|["']$/g, '')
  if (!t) return null
  const hit = codes.find((c) => c.toLowerCase() === t.toLowerCase())
  return hit ?? null
}
