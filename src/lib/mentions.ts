import type { MentionCandidate } from '../data/db'

/**
 * Resolve @mention tokens in a comment body against the candidate list.
 * A token matches a candidate by display name ("@Jane Doe") or email local
 * part ("@jane.doe"); matched users are returned as display names (what
 * post_request_comment resolves server-side). Unmatched @text stays plain text.
 */
export function parseMentions(body: string, candidates: MentionCandidate[]): string[] {
  const lower = body.toLowerCase()
  const out: string[] = []
  for (const c of candidates) {
    const dn = c.display_name?.trim()
    const local = c.email ? (c.email.split('@')[0] ?? '').toLowerCase() : ''
    const hit = (dn && dn.length >= 2 && lower.includes(`@${dn.toLowerCase()}`)) || (local && lower.includes(`@${local}`))
    if (hit && dn && !out.includes(dn)) out.push(dn)
  }
  return out
}
