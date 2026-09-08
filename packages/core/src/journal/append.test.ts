import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseJournal } from './parse.js'
import { appendJournalEvent } from './append.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-journal-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

describe('appendJournalEvent', () => {
  it('seeds a new file with frontmatter when missing', async () => {
    const path = join(dir, 'journal.md')
    await appendJournalEvent({
      path,
      event: {
        timestamp: '2026-05-03T08:28:00+08:00',
        tag: 'CREATE',
        body: '`foo-260503-082800` PENDING',
      },
    })
    const content = await fs.readFile(path, 'utf8')
    expect(content).toMatch(/^---\n/)
    expect(content).toContain('last_digest_at: null')
    expect(content).toContain('[CREATE]')
  })

  it('appends to an existing file without modifying frontmatter', async () => {
    const path = join(dir, 'journal.md')
    const initial = `---
last_digest_at: 2026-05-03T10:00:00+08:00
---

- 2026-05-03T08:28:00+08:00 [CREATE] \`foo-260503-082800\` PENDING
`
    await fs.writeFile(path, initial, 'utf8')
    await appendJournalEvent({
      path,
      event: {
        timestamp: '2026-05-03T11:00:00+08:00',
        tag: 'NOTE',
        body: '`foo-260503-082800` looks good',
      },
    })
    const parsed = parseJournal(await fs.readFile(path, 'utf8'))
    expect(parsed.lastDigestAt).toBe('2026-05-03T10:00:00+08:00')
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[1]!.tag).toBe('NOTE')
  })
})
