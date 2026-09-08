// Contract tests for `memon journal submit --files`.
//
// What must hold: only managed Experiment / Wiki files are accepted, the
// recorded digests are the bytes actually on disk, one bad path rejects the
// whole batch without recording a partial file set, and an identical
// re-submission is recorded as a no-op rather than as new content.

import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJournalInvocations } from '@memon/core'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  beginCliInvocation,
  finishCliInvocation,
  resetCliInvocationForTest,
} from '../lib/invocation.js'
import { runJournalSubmit } from './journal-submit.js'

const EXPERIMENT_README = 'docs/experiments/E0001-foo/README.md'
const EXPERIMENT_YAML = 'docs/experiments/E0001-foo/results.yaml'
const WIKI_PAGE = 'docs/wiki/guide/W0001-alpha.md'

interface SubmitOutput {
  invocationId: string
  outcome: string
  files: { path: string; sha1: string }[]
  targets: { type: string; id: string }[]
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

async function seed(relPath: string, content: string): Promise<void> {
  const abs = join(root, ...relPath.split('/'))
  await fs.mkdir(join(abs, '..'), { recursive: true })
  await fs.writeFile(abs, content, 'utf8')
}

/**
 * Submissions go through the real interception hooks, so the receipt these
 * tests read is the one an operator would get from the actual CLI — including
 * on the synchronous error-exit path.
 */
function buildProgram(): Command {
  const program = new Command()
  program.name('memon').exitOverride()
  program.option('--project-root <path>', 'project root')
  program.hook('preAction', async (_thisCommand, actionCommand) => {
    await beginCliInvocation({
      command: actionCommand,
      globalProjectRoot: program.opts<{ projectRoot?: string }>().projectRoot,
      cwd: root,
    })
  })
  program.hook('postAction', async () => {
    await finishCliInvocation()
  })
  program
    .command('journal')
    .command('submit')
    .requiredOption('--files <paths...>', 'managed files')
    .action(async (opts: { files: string[] }) => {
      await runJournalSubmit({ cwd: root, projectRoot: root, format: 'json', files: opts.files })
    })
  return program
}

function argvFor(files: string[]): string[] {
  return ['node', 'memon', '--project-root', root, 'journal', 'submit', '--files', ...files]
}

async function submit(files: string[]): Promise<SubmitOutput> {
  stdoutChunks = []
  await buildProgram().parseAsync(argvFor(files))
  return JSON.parse(stdoutChunks.join('').trim()) as SubmitOutput
}

async function expectRejection(files: string[], exitCode: number): Promise<string> {
  stderrChunks = []
  await expect(buildProgram().parseAsync(argvFor(files))).rejects.toMatchObject({ exitCode })
  return stderrChunks.join('')
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-submit-'))
  await seed(EXPERIMENT_README, '# E0001\n')
  await seed(EXPERIMENT_YAML, 'schema_version: 1\n')
  await seed(WIKI_PAGE, '# Alpha\n')
  resetCliInvocationForTest()
  stdoutChunks = []
  stderrChunks = []
  realStdoutWrite = process.stdout.write.bind(process.stdout)
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdoutChunks.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderrChunks.push(String(chunk))
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
  resetCliInvocationForTest()
  await fs.rm(root, { recursive: true, force: true })
})

describe('accepted submissions', () => {
  it('records the digests of the bytes currently on disk', async () => {
    const out = await submit([EXPERIMENT_README, EXPERIMENT_YAML, WIKI_PAGE])

    expect(out.outcome).toBe('success')
    expect(out.files.map((f) => f.path)).toEqual([EXPERIMENT_README, EXPERIMENT_YAML, WIKI_PAGE])
    expect(out.files[0]!.sha1).toBe(createHash('sha1').update('# E0001\n').digest('hex'))
    expect(out.targets).toEqual([
      { type: 'experiment', id: 'E0001-foo' },
      { type: 'wiki', id: 'W0001-alpha' },
    ])

    const [record] = await readJournalInvocations(root)
    expect(record!.details).toEqual([
      { kind: 'target', type: 'experiment', id: 'E0001-foo' },
      { kind: 'target', type: 'wiki', id: 'W0001-alpha' },
      // No preimage is ever fabricated from a caller claim.
      { kind: 'file-change', path: EXPERIMENT_README, before: null, after: out.files[0]!.sha1 },
      { kind: 'file-change', path: EXPERIMENT_YAML, before: null, after: out.files[1]!.sha1 },
      { kind: 'file-change', path: WIKI_PAGE, before: null, after: out.files[2]!.sha1 },
    ])
    expect(record!.outcome).toBe('success')
  })

  it('records an identical re-submission as a no-op', async () => {
    const first = await submit([EXPERIMENT_README])
    const again = await submit([EXPERIMENT_README])

    expect(again.outcome).toBe('noop')
    const records = await readJournalInvocations(root)
    // Retries are distinct invocations: two receipts, two ids, one no-op.
    expect(records).toHaveLength(2)
    expect(records.find((record) => record.id === first.invocationId)?.outcome).toBe('success')
    expect(records.find((record) => record.id === again.invocationId)?.outcome).toBe('noop')
    expect(first.invocationId).not.toBe(again.invocationId)
  })

  it('does not infer a no-op from conflicting submissions with tied timestamps', async () => {
    const original = '# E0001\n'
    const originalHash = createHash('sha1').update(original).digest('hex')
    await submit([EXPERIMENT_README])
    await seed(EXPERIMENT_README, '# Revised\n')
    await submit([EXPERIMENT_README])
    for (const record of await readJournalInvocations(root)) {
      await fs.rm(join(root, '.memon/activity', `${record.id}.json`))
      const originalContent = (record.details ?? []).some(
        (detail) => detail.kind === 'file-change' && detail.after === originalHash,
      )
      record.id = originalContent ? 'z-original' : 'a-revised'
      record.startedAt = record.finishedAt = '2026-01-01T12:00:00+00:00'
      await seed(`.memon/activity/${record.id}.json`, JSON.stringify(record))
    }
    await seed(EXPERIMENT_README, original)

    expect((await submit([EXPERIMENT_README])).outcome).toBe('success')
  })

  it('records a changed file as new content again', async () => {
    await submit([EXPERIMENT_README])
    await seed(EXPERIMENT_README, '# E0001 revised\n')

    expect((await submit([EXPERIMENT_README])).outcome).toBe('success')
  })
})

describe('rejected submissions', () => {
  it.each([
    ['a run README', 'logs/foo-260901-090000/README.md'],
    ['a hypotheses file', 'docs/hypotheses.md'],
    ['legacy journal history', 'docs/journal.md'],
    ['a file outside a bundle', 'docs/experiments/README.md'],
    ['an absolute path', '/etc/hosts'],
    ['a traversal', 'docs/experiments/E0001-foo/../../../etc/hosts'],
  ])('rejects %s', async (_label, path) => {
    const stderr = await expectRejection([path], 2)

    expect(stderr).toContain('BAD_REQUEST')
  })

  it('rejects a managed path that does not exist with NOT_FOUND', async () => {
    const stderr = await expectRejection(['docs/experiments/E0001-foo/missing.yaml'], 4)

    expect(stderr).toContain('NOT_FOUND')
  })

  it('records the rejected invocation as a failure without any file details', async () => {
    await expectRejection([EXPERIMENT_README, 'docs/hypotheses.md'], 2)

    const [record] = await readJournalInvocations(root)
    expect(record).toMatchObject({ command: 'journal submit', outcome: 'failure' })
    expect(record!.details ?? []).toEqual([])
  })

  it('rejects the whole batch when only one path is bad', async () => {
    await expectRejection(['docs/hypotheses.md', EXPERIMENT_README], 2)

    const records = await readJournalInvocations(root)
    expect(records).toHaveLength(1)
    expect(records[0]!.outcome).toBe('failure')
  })
})
