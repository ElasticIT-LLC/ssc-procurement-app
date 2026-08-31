import { describe, expect, it } from 'vitest'
import { parseMentions } from './mentions'
import type { MentionCandidate } from '../data/db'

const cands: MentionCandidate[] = [
  { user_id: 'u1', display_name: 'Jane Doe', email: 'jane.doe@x.com' },
  { user_id: 'u2', display_name: 'John Smith', email: 'john@x.com' },
]

describe('parseMentions', () => {
  it('resolves @display-name tokens case-insensitively', () => {
    expect(parseMentions('ping @Jane Doe about it', cands)).toEqual(['Jane Doe'])
  })
  it('resolves @email-local-part tokens to the display name', () => {
    expect(parseMentions('ping @john', cands)).toEqual(['John Smith'])
  })
  it('returns multiple unique matches in candidate order', () => {
    expect(parseMentions('@John Smith and @jane.doe@x.com', cands)).toEqual(['Jane Doe', 'John Smith'])
  })
  it('leaves unmatched @text out', () => {
    expect(parseMentions('@nobody here', cands)).toEqual([])
  })
  it('does not double-count a user matched by name and email', () => {
    expect(parseMentions('@Jane Doe and @jane.doe@x.com', cands)).toEqual(['Jane Doe'])
  })
})
