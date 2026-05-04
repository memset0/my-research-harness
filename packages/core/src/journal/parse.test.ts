import { describe, expect, it } from 'vitest'
import { parseJournal } from './parse.js'

const SAMPLE = `---
last_digest_at: 2026-05-03T10:00:00+08:00
---

- 2026-05-03T08:28:00+08:00 [CREATE]   \`foo-260503-082800\` PENDING
- 2026-05-03T08:30:15+08:00 [STATUS]   \`foo-260503-082800\` PENDING → RUNNING
- 2026-05-03T09:45:00+08:00 [STATUS]   \`foo-260503-082800\` RUNNING → FINISHED
- 2026-05-03T10:15:00+08:00 [NOTE]     \`foo-260503-082800\` converged faster than expected
- 2026-05-03T11:00:00+08:00 [REQUEST]  please summarize experiments related to H0007
- 2026-05-03T12:00:00+08:00 [ARCHIVE]  \`old-260101-000000\`
- 2026-05-03T13:00:00+08:00 [ERROR]    disk full on /mnt/p
`

describe('parseJournal', () => {
  it('parses last_digest_at and all events', () => {
    const parsed = parseJournal(SAMPLE)
    expect(parsed.parseErrors).toEqual([])
    expect(parsed.lastDigestAt).toBe('2026-05-03T10:00:00+08:00')
    expect(parsed.events).toHaveLength(7)
  })

  it('extracts experiment id and status transitions for [STATUS]', () => {
    const parsed = parseJournal(SAMPLE)
    const status = parsed.events.find((e) => e.tag === 'STATUS' && e.statusFrom === 'PENDING')
    expect(status).toBeTruthy()
    expect(status!.experimentId).toBe('foo-260503-082800')
    expect(status!.statusTo).toBe('RUNNING')
  })

  it('extracts experiment id for [NOTE]', () => {
    const parsed = parseJournal(SAMPLE)
    const note = parsed.events.find((e) => e.tag === 'NOTE')
    expect(note?.experimentId).toBe('foo-260503-082800')
  })

  it('handles missing frontmatter gracefully', () => {
    const noFm = `- 2026-05-03T08:28:00+08:00 [CREATE]   \`foo-260503-082800\` PENDING\n`
    const parsed = parseJournal(noFm)
    expect(parsed.lastDigestAt).toBeNull()
    expect(parsed.events).toHaveLength(1)
    expect(parsed.parseWarnings.some((w) => /no frontmatter/i.test(w.message))).toBe(true)
  })

  it('warns on unknown tags but still records the event', () => {
    const withUnknown = `---
last_digest_at: null
---

- 2026-05-03T12:00:00+08:00 [WEIRD] something
`
    const parsed = parseJournal(withUnknown)
    expect(parsed.events).toHaveLength(1)
    expect(parsed.events[0]!.tag).toBe('WEIRD')
    expect(parsed.parseWarnings.some((w) => /unknown event tag/i.test(w.message))).toBe(true)
  })

  it('warns on malformed event lines starting with -', () => {
    const malformed = `---
last_digest_at: null
---

- 2026-05-03 missing tag
`
    const parsed = parseJournal(malformed)
    expect(parsed.parseWarnings.some((w) => /malformed event line/i.test(w.message))).toBe(true)
  })
})
