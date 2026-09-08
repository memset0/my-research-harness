// Contract tests for the invocation ledger.
//
// The load-bearing claims are: an invocation is visible before it finishes, a
// finish cannot lie about the outcome, a failed or no-op mutation is still
// recorded, native legacy appends inside a scope leave the preserved file
// untouched, and nothing secret or machine-specific reaches disk.

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { appendJournalEvent } from './append.js'
import {
  beginJournalInvocation,
  type JournalInvocationRecord,
  JournalRecordingError,
  readJournalActivity,
  readJournalInvocations,
  sanitizeInvocationParameters,
  withJournalInvocation,
} from './invocation.js'

let root: string

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-ledger-'))
})

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true })
})

describe('withJournalInvocation', () => {
  it('records a running state before the action finishes, then the outcome', async () => {
    let midFlight: JournalInvocationRecord[] = []

    const result = await withJournalInvocation(
      root,
      { command: 'experiment link', origin: 'cli', parameters: { args: ['E0001-foo'] } },
      async () => {
        midFlight = await readJournalInvocations(root)
        return 'linked'
      },
    )

    expect(result).toBe('linked')
    expect(midFlight).toHaveLength(1)
    expect(midFlight[0]).toMatchObject({ outcome: 'running', finishedAt: null })

    const final = await readJournalInvocations(root)
    expect(final).toHaveLength(1)
    expect(final[0]).toMatchObject({
      command: 'experiment link',
      origin: 'cli',
      outcome: 'success',
      parameters: { args: ['E0001-foo'] },
    })
    expect(final[0]!.finishedAt).not.toBeNull()
    expect(final[0]!.id).toBe(midFlight[0]!.id)
  })

  it('records a failure with the thrown error code and rethrows', async () => {
    const boom = Object.assign(new Error('README moved'), { code: 'MTIME_CONFLICT' })

    await expect(
      withJournalInvocation(root, { command: 'run status set', origin: 'cli' }, async () => {
        throw boom
      }),
    ).rejects.toBe(boom)

    const [record] = await readJournalInvocations(root)
    // A conflict is not a generic failure: callers branch on the distinction.
    expect(record).toMatchObject({ outcome: 'conflict', errorCode: 'MTIME_CONFLICT' })
    expect(record!.finishedAt).not.toBeNull()
  })

  it('records an explicitly marked no-op mutation', async () => {
    await withJournalInvocation(root, { command: 'wiki set', origin: 'web' }, async (ctx) => {
      ctx.markOutcome('noop')
    })

    const [record] = await readJournalInvocations(root)
    expect(record).toMatchObject({ outcome: 'noop', origin: 'web' })
  })

  it('joins a nested invocation into one receipt instead of duplicating it', async () => {
    await withJournalInvocation(root, { command: 'experiment delete', origin: 'cli' }, async () => {
      await withJournalInvocation(root, { command: 'experiment unlink', origin: 'cli' }, async (ctx) => {
        ctx.addDetail({ kind: 'target', type: 'run', id: 'foo-260901-090000' })
      })
    })

    const records = await readJournalInvocations(root)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ command: 'experiment delete', outcome: 'success' })
    expect(records[0]!.details).toEqual([
      { kind: 'target', type: 'run', id: 'foo-260901-090000' },
    ])
  })
})

describe('legacy append interception', () => {
  it('absorbs an in-scope native append as typed metadata and writes no bytes', async () => {
    const legacy = join(root, 'docs', 'journal.md')

    await withJournalInvocation(root, { command: 'run status set', origin: 'cli' }, async () => {
      await appendJournalEvent({
        path: legacy,
        event: {
          timestamp: '2026-09-01T09:10:00+08:00',
          tag: 'STATUS',
          body: '`foo-260901-090000` PENDING -> RUNNING (operator note: rerun of E0001-foo)',
        },
      })
    })

    await expect(fs.readFile(legacy, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const [record] = await readJournalInvocations(root)
    expect(record!.details).toEqual([
      {
        kind: 'legacy-event',
        tag: 'STATUS',
        timestamp: '2026-09-01T09:10:00+08:00',
        refs: ['foo-260901-090000', 'E0001-foo'],
        statusFrom: 'PENDING',
        statusTo: 'RUNNING',
      },
    ])
    // The historical prose must not be copied into the new ledger.
    expect(JSON.stringify(record)).not.toContain('operator note')
  })

  it('leaves the unscoped legacy append behaviour unchanged', async () => {
    const legacy = join(root, 'docs', 'journal.md')

    await appendJournalEvent({
      path: legacy,
      event: { timestamp: '2026-09-01T09:00:00+08:00', tag: 'NOTE', body: 'historical line' },
    })

    expect(await fs.readFile(legacy, 'utf8')).toContain(
      '- 2026-09-01T09:00:00+08:00 [NOTE] historical line',
    )
    // No receipt is fabricated for a call no invocation claimed.
    expect(await readJournalInvocations(root)).toEqual([])
  })
})

describe('interrupted invocations', () => {
  it('stays visible as running until a terminal write lands', async () => {
    const handle = await beginJournalInvocation(root, { command: 'wiki commit', origin: 'cli' })

    const [pending] = await readJournalInvocations(root)
    expect(pending).toMatchObject({ outcome: 'running', finishedAt: null })

    handle.finishSync('partial', 'INTERRUPTED')

    const [done] = await readJournalInvocations(root)
    expect(done).toMatchObject({ outcome: 'partial', errorCode: 'INTERRUPTED' })
    expect(done!.finishedAt).not.toBeNull()
  })

  it('refuses to overwrite a terminal outcome with a second finish', async () => {
    const handle = await beginJournalInvocation(root, { command: 'wiki delete', origin: 'cli' })
    await handle.finish('failure', 'NOT_FOUND')
    handle.finishSync('success')

    const [record] = await readJournalInvocations(root)
    expect(record).toMatchObject({ outcome: 'failure', errorCode: 'NOT_FOUND' })
  })
})

describe('readJournalActivity', () => {
  it('reports an undecodable receipt instead of shrinking history', async () => {
    await withJournalInvocation(root, { command: 'wiki create', origin: 'cli' }, async () => {})
    await fs.writeFile(join(root, '.memon', 'activity', 'garbage.json'), '{ not json', 'utf8')

    const snapshot = await readJournalActivity(root)

    expect(snapshot.records).toHaveLength(1)
    expect(snapshot.unreadable).toHaveLength(1)
    expect(snapshot.unreadable[0]!.file).toBe('garbage.json')
  })

  it('treats a project with no activity directory as empty, not an error', async () => {
    const snapshot = await readJournalActivity(root)

    expect(snapshot).toEqual({ dir: null, records: [], unreadable: [] })
  })
})

describe('recording failures reach the caller', () => {
  it('throws JournalRecordingError after a successful action, without undoing it', async () => {
    // `.memon` occupied by a regular file: the receipt cannot be written.
    await fs.writeFile(join(root, '.memon'), 'not a directory', 'utf8')
    let ran = false

    const call = withJournalInvocation(
      root,
      { command: 'wiki set', origin: 'web' },
      async () => {
        ran = true
        return 'edited'
      },
      { onRecordingFailure: () => {} },
    )

    await expect(call).rejects.toMatchObject({ code: 'JOURNAL_RECORD_INCOMPLETE' })
    expect(ran).toBe(true)
    // The blocker is still exactly as the operation left it: no rollback, and
    // no receipt tree conjured somewhere else.
    expect(await fs.readFile(join(root, '.memon'), 'utf8')).toBe('not a directory')
  })

  it('reports a safe code without leaking filesystem paths', async () => {
    await fs.writeFile(join(root, '.memon'), 'x', 'utf8')
    const failures: string[] = []

    await expect(
      withJournalInvocation(root, { command: 'wiki set', origin: 'web' }, async () => 1, {
        onRecordingFailure: (failure) => failures.push(failure.message),
      }),
    ).rejects.toBeInstanceOf(JournalRecordingError)

    expect(failures.length).toBeGreaterThan(0)
    for (const message of failures) expect(message).not.toContain(root)
  })

  it('keeps the operation error when the action and the receipt both fail', async () => {
    await fs.writeFile(join(root, '.memon'), 'x', 'utf8')
    const boom = Object.assign(new Error('write refused'), { code: 'MTIME_CONFLICT' })

    await expect(
      withJournalInvocation(
        root,
        { command: 'run status set', origin: 'cli' },
        async () => {
          throw boom
        },
        { onRecordingFailure: () => {} },
      ),
    ).rejects.toBe(boom)
  })

  it('refuses to follow a .memon symlink out of the project', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'memon-outside-'))
    await fs.symlink(outside, join(root, '.memon'))

    await expect(
      withJournalInvocation(root, { command: 'wiki commit', origin: 'cli' }, async () => 1, {
        onRecordingFailure: () => {},
      }),
    ).rejects.toBeInstanceOf(JournalRecordingError)

    expect(await fs.readdir(outside)).toEqual([])
    await fs.rm(outside, { recursive: true, force: true })
  })
})

describe('sanitizeInvocationParameters', () => {
  it('drops secrets, sizes bodies, and relativizes paths', () => {
    const sanitized = sanitizeInvocationParameters(
      {
        token: 'super-secret',
        sessionSecret: 'nope',
        stdinContent: 'x'.repeat(4096),
        page: join(root, 'docs', 'wiki', 'guide', 'W0001-a.md'),
        elsewhere: '/etc/shadow',
        expectedMtime: 17,
        force: true,
        missing: undefined,
      },
      root,
    )

    expect(sanitized).toEqual({
      token: '[redacted]',
      sessionSecret: '[redacted]',
      stdinContent: '[omitted 4096 chars]',
      page: 'docs/wiki/guide/W0001-a.md',
      elsewhere: '[external path]',
      expectedMtime: 17,
      force: true,
    })
  })
})
