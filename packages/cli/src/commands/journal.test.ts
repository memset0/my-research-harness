// CLI tests for the diagnostic `memon journal read` query.
//
// Covers the reported filter bug (a supplied entity filter was parsed under a
// different option name and silently ignored, so unrelated events came back),
// instant-vs-string `--since` comparison, AND composition, bounded limits,
// cursor paging across tied timestamps and cursor invalidation, plus the
// merged stream of legacy lines and typed invocation receipts.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withJournalInvocation } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runJournalRead } from './journal.js'

// `2026-09-01T02:45:00+00:00` is the LAST event in file order but its lexical
// form sorts before every `+08:00` line — the case a string comparison gets
// wrong.
const HISTORY = `---
last_digest_at: 2026-08-01T10:00:00+08:00
---

- 2026-09-01T09:00:00+08:00 [EXPERIMENT] \`E0001-foo\` op=create slug=foo
- 2026-09-01T09:05:00+08:00 [BIND] \`E0001-foo\` op=link run=foo-260901-090000
- 2026-09-01T09:10:00+08:00 [STATUS] \`foo-260901-090000\` PENDING → RUNNING
- 2026-09-01T09:20:00+08:00 [NOTE] \`E0002-bar\` unrelated experiment note
- 2026-09-01T09:30:00+08:00 [NOTE] loose historical prose with no ids
- 2026-09-01T02:45:00+00:00 [NOTE] \`E0001-foo\` written from a UTC host
`

const TIED = `---
last_digest_at: null
---

- 2026-09-02T08:00:00+08:00 [NOTE] \`E0001-foo\` first
- 2026-09-02T08:00:00+08:00 [NOTE] \`E0001-foo\` second
- 2026-09-02T08:00:00+08:00 [NOTE] \`E0001-foo\` third
`

interface JournalReadOutput {
  sources: {
    origin: string
    path: string | null
    available: boolean
    totalEvents: number
    unreadable?: { file: string; reason: string }[]
  }[]
  matched: number
  returned: number
  nextCursor: string | null
  events: {
    origin: string
    tag: string
    body?: string
    command?: string
    outcome?: string
    errorCode?: string | null
    changedPaths?: string[]
    association: {
      known: boolean
      experimentIds: string[]
      runIds: string[]
      otherIds: string[]
      unresolvedRefs: string[]
    }
  }[]
}

let root: string
let stdoutChunks: string[]
let stderrChunks: string[]
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-journal-read-'))
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  await fs.writeFile(join(root, 'docs', 'journal.md'), HISTORY, 'utf8')

  stdoutChunks = []
  stderrChunks = []
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit
  process.stdout.write = ((c: unknown) => {
    stdoutChunks.push(String(c))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((c: unknown) => {
    stderrChunks.push(String(c))
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
})

afterEach(async () => {
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  process.exit = realExit
  await fs.rm(root, { recursive: true, force: true })
})

async function read(opts: Record<string, string> = {}): Promise<JournalReadOutput> {
  stdoutChunks = []
  await runJournalRead({ cwd: root, projectRoot: root, format: 'json', ...opts })
  return JSON.parse(stdoutChunks.join('').trim()) as JournalReadOutput
}

async function expectBadRequest(opts: Record<string, string>): Promise<string> {
  stderrChunks = []
  await expect(
    runJournalRead({ cwd: root, projectRoot: root, format: 'json', ...opts }),
  ).rejects.toMatchObject({ exitCode: 2 })
  return stderrChunks.join('')
}

describe('memon journal read — entity filters', () => {
  it('returns only events associated with the requested experiment', async () => {
    const out = await read({ experimentId: 'E0001-foo' })

    expect(out.matched).toBe(3)
    expect(out.events.map((e) => e.tag)).toEqual(['EXPERIMENT', 'BIND', 'NOTE'])
    for (const event of out.events) {
      expect(event.association.experimentIds).toContain('E0001-foo')
    }
    expect(out.events.some((e) => (e.body ?? '').includes('E0002-bar'))).toBe(false)
    expect(out.events.some((e) => (e.body ?? '').includes('loose historical prose'))).toBe(false)
  })

  it('accepts the bare E<NNNN> form', async () => {
    const out = await read({ experimentId: 'E0002' })

    expect(out.matched).toBe(1)
    expect(out.events[0]!.association.experimentIds).toEqual(['E0002-bar'])
  })

  it('returns only events explicitly associated with the requested run', async () => {
    const out = await read({ runId: 'foo-260901-090000' })

    // The BIND line names the run via `run=`; the STATUS line via its
    // backticked id. The create line names the experiment only.
    expect(out.events.map((e) => e.tag)).toEqual(['BIND', 'STATUS'])
    expect(out.events.every((e) => e.association.runIds.includes('foo-260901-090000'))).toBe(true)
  })

  it('reports unknown association for a legacy line with no typed reference', async () => {
    const out = await read({ tag: 'NOTE' })
    const loose = out.events.find((e) => (e.body ?? '').includes('loose historical prose'))!

    expect(loose.association).toEqual({
      known: false,
      experimentIds: [],
      runIds: [],
      otherIds: [],
      unresolvedRefs: [],
    })
  })

  it('rejects a run-shaped --experiment-id with a --run-id hint', async () => {
    const stderr = await expectBadRequest({ experimentId: 'foo-260901-090000' })

    expect(stderr).toContain('BAD_REQUEST')
    expect(stderr).toContain('--run-id foo-260901-090000')
  })

  it('rejects an experiment-shaped --run-id with an --experiment-id hint', async () => {
    const stderr = await expectBadRequest({ runId: 'E0001-foo' })

    expect(stderr).toContain('BAD_REQUEST')
    expect(stderr).toContain('--experiment-id E0001-foo')
  })
})

describe('memon journal read — time and composition', () => {
  it('compares instants, not offset-carrying strings', async () => {
    // `--since` is 02:00Z. Only the 02:45Z line qualifies, even though four
    // `+08:00` lines sort later lexically and one sorts earlier.
    const out = await read({ since: '2026-09-01T10:00:00+08:00' })

    expect(out.matched).toBe(1)
    expect(out.events[0]!.body).toContain('written from a UTC host')
  })

  it('composes tag, time and entity filters with AND', async () => {
    const out = await read({
      tag: 'NOTE',
      experimentId: 'E0001-foo',
      since: '2026-09-01T10:00:00+08:00',
    })

    expect(out.matched).toBe(1)
    expect(out.events[0]!.body).toContain('written from a UTC host')
  })

  it('rejects a --since without an explicit offset', async () => {
    const stderr = await expectBadRequest({ since: '2026-09-01T10:00:00' })

    expect(stderr).toContain('explicit offset')
  })

  it.each(['0', '-1', '1001', 'abc'])('rejects --limit %s', async (limit) => {
    const stderr = await expectBadRequest({ limit })

    expect(stderr).toContain('between 1 and 1000')
  })
})

describe('memon journal read — paging', () => {
  beforeEach(async () => {
    await fs.writeFile(join(root, 'docs', 'journal.md'), TIED, 'utf8')
  })

  it('pages across events sharing one timestamp without skipping or repeating', async () => {
    const first = await read({ limit: '2' })
    expect(first.returned).toBe(2)
    expect(first.matched).toBe(3)
    expect(first.nextCursor).not.toBeNull()

    const second = await read({ limit: '2', cursor: first.nextCursor! })
    expect(second.returned).toBe(1)
    expect(second.nextCursor).toBeNull()

    const bodies = [...first.events, ...second.events].map((e) => e.body)
    expect(bodies).toEqual(['`E0001-foo` first', '`E0001-foo` second', '`E0001-foo` third'])
  })

  it('refuses a cursor issued for a different filter set', async () => {
    const first = await read({ limit: '1' })

    const stderr = await expectBadRequest({
      limit: '1',
      cursor: first.nextCursor!,
      tag: 'NOTE',
    })
    expect(stderr).toContain('different project or filter set')
  })

  it('rejects a cursor that points past the end of the current stream', async () => {
    const first = await read({ limit: '2' })
    const cursor = first.nextCursor!
    await fs.writeFile(
      join(root, 'docs', 'journal.md'),
      TIED.split('\n').slice(0, 5).join('\n'),
      'utf8',
    )

    const stderr = await expectBadRequest({ limit: '2', cursor })
    expect(stderr).toContain('past the end')
  })
})

describe('memon journal read — missing history', () => {
  it('succeeds with no events when the legacy file is absent', async () => {
    await fs.rm(join(root, 'docs', 'journal.md'))

    const out = await read()

    expect(out.sources[0]).toMatchObject({ path: null, available: false, totalEvents: 0 })
    expect(out.events).toEqual([])
    expect(out.nextCursor).toBeNull()
  })
})

describe('memon journal read — merged invocation receipts', () => {
  beforeEach(async () => {
    await withJournalInvocation(
      root,
      { command: 'experiment link', origin: 'cli', parameters: { args: ['E0001-foo'] } },
      async (ctx) => {
        ctx.addDetail({ kind: 'target', type: 'experiment', id: 'E0001-foo' })
        ctx.addDetail({ kind: 'target', type: 'run', id: 'foo-260901-090000' })
        ctx.addDetail({
          kind: 'file-change',
          path: 'docs/experiments/E0001-foo/README.md',
          before: null,
          after: 'a'.repeat(40),
        })
      },
    )
    await withJournalInvocation(root, { command: 'wiki set', origin: 'web' }, async (ctx) => {
      ctx.markOutcome('conflict', 'MTIME_CONFLICT')
      ctx.addDetail({ kind: 'target', type: 'wiki', id: 'W0001-alpha' })
    })
  })

  it('returns legacy lines and receipts in one origin-labelled stream', async () => {
    const out = await read()

    expect(out.sources.map((s) => s.origin)).toEqual(['legacy-markdown', 'invocation-receipt'])
    expect(out.sources[1]).toMatchObject({ available: true, totalEvents: 2 })
    expect(out.matched).toBe(8)
    const receipts = out.events.filter((e) => e.origin === 'invocation-receipt')
    expect(receipts.map((e) => e.command).sort()).toEqual(['experiment link', 'wiki set'])
    expect(receipts.map((e) => e.tag)).toEqual(['INVOCATION', 'INVOCATION'])
  })

  it('keeps a failed mutation in history with its error code', async () => {
    const out = await read({ outcome: 'conflict' })

    expect(out.matched).toBe(1)
    expect(out.events[0]).toMatchObject({
      origin: 'invocation-receipt',
      command: 'wiki set',
      outcome: 'conflict',
      errorCode: 'MTIME_CONFLICT',
    })
    expect(out.events[0]!.association.otherIds).toEqual(['W0001-alpha'])
  })

  it('reports the paths a receipt says it changed', async () => {
    const out = await read({ origin: 'invocation', outcome: 'success' })

    expect(out.events[0]!.changedPaths).toEqual(['docs/experiments/E0001-foo/README.md'])
  })

  it('restricts the stream to one origin on request', async () => {
    const legacyOnly = await read({ origin: 'legacy' })
    expect(legacyOnly.events.every((e) => e.origin === 'legacy-markdown')).toBe(true)
    expect(legacyOnly.matched).toBe(6)
  })

  it('applies entity filters across both origins', async () => {
    const out = await read({ runId: 'foo-260901-090000' })

    expect(out.events.map((e) => e.origin)).toEqual([
      'legacy-markdown',
      'legacy-markdown',
      'invocation-receipt',
    ])
  })

  it('rejects --outcome combined with the legacy origin', async () => {
    const stderr = await expectBadRequest({ origin: 'legacy', outcome: 'success' })

    expect(stderr).toContain('--outcome only applies to invocation receipts')
  })
})
