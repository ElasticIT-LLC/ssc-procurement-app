import type { MentionCandidate } from '../data/db'

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Resolve @mention tokens in a comment body against the candidate list.
 * A token matches a candidate by display name ("@Jane Doe") or email local
 * part ("@jane.doe", including the local part of a full email such as
 * "@jane.doe@x.com"); matched users are returned as display names (what
 * post_request_comment resolves server-side). Tokens are boundary-checked so
 * a shorter local part never matches inside a longer email token. Unmatched
 * @text stays plain text.
 */
export function parseMentions(body: string, candidates: MentionCandidate[]): string[] {
  const lower = body.toLowerCase()
  const out: string[] = []
  for (const c of candidates) {
    const dn = c.display_name?.trim()
    const local = c.email ? (c.email.split('@')[0] ?? '').toLowerCase() : ''
    let hit = false
    if (dn && dn.length >= 2) {
      hit = new RegExp(`@${escapeRe(dn.toLowerCase()).replace(/ /g, '\\s+')}(?![a-z0-9.-])`).test(lower)
    }
    if (!hit && local && local.length >= 2) {
      hit = new RegExp(`@${escapeRe(local)}(?![a-z0-9.-])`).test(lower)
    }
    if (hit && dn && !out.includes(dn)) out.push(dn)
  }
  return out
}
