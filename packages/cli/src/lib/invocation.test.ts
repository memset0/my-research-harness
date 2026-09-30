// Contract tests for automatic CLI interception.
//
// The behaviour that matters to an operator reading history later:
//   * a mutating command produces exactly one receipt, without the command's
//     author writing any ledger code
//   * a rejected mutating command still produces a receipt (failure), because
//     the ledger records invocations, not just successful writes
//   * reads, dry-runs and host-scoped operations produce nothing
//   * the receipt lands in the project the command itself resolved, including
//     the implicit-cwd case, and nowhere at all when no project resolves
//   * an unclassified command is reported, never silently classified

import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJournalInvocations } from '@memon/core'
import { Command } from 'commander'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { emitErrorAndExit } from './emit-error.js'
import {
  beginCliInvocation,
  classifyCliCommand,
  cliCommandPath,
  finishCliInvocation,
  resetCliInvocationForTest,
} from './invocation.js'

let root: string
let stderrChunks: string[]
let realStderrWrite: typeof process.stderr.write
let realExit: typeof process.exit

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

/**
 * A stand-in for `src/index.ts`: the same hooks, so what is under test is the
 * interception wiring rather than a reimplementation of it.
 */
function buildProgram(action: () => Promise<void>): Command {
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

  const experiment = program.command('experiment')
  experiment.command('link <exp> <run>').action(async () => {
    await action()
  })
  experiment.command('ls').action(async () => {
    await action()
  })
  program
    .command('wiki-migrate')
    .option('--dry-run', 'report only', false)
    .action(async () => {
      await action()
    })
  program.command('serve').action(async () => {
    await action()
  })
  return program
}

beforeEach(async () => {
  root = await fs.mkdtemp(join(tmpdir(), 'memon-cli-ledger-'))
  await fs.mkdir(join(root, 'docs'), { recursive: true })
  resetCliInvocationForTest()
  stderrChunks = []
  realStderrWrite = process.stderr.write.bind(process.stderr)
  realExit = process.exit
  process.stderr.write = ((chunk: unknown) => {
    stderrChunks.push(String(chunk))
    return true
  }) as typeof process.stderr.write
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
})

afterEach(async () => {
  process.stderr.write = realStderrWrite
  process.exit = realExit
  resetCliInvocationForTest()
  await fs.rm(root, { recursive: true, force: true })
})

describe('command classification', () => {
  it('reads the full command path from the Commander tree', () => {
    const program = buildProgram(async () => {})
    const link = program.commands
      .find((c) => c.name() === 'experiment')!
      .commands.find((c) => c.name() === 'link')!

    expect(cliCommandPath(link)).toBe('experiment link')
  })

  it.each([
    ['experiment link', 'project'],
    ['experiment ls', 'readonly'],
    ['journal read', 'readonly'],
    ['wiki kinds ls', 'readonly'],
    ['wiki kinds show', 'readonly'],
    ['journal submit', 'project'],
    ['serve', 'host'],
    ['update', 'host'],
    ['components run', 'project'],
  ])('classifies %s as %s', (path, expected) => {
    expect(classifyCliCommand(path, {})).toBe(expected)
  })

  it('treats a --dry-run mutation as a read', () => {
    expect(classifyCliCommand('wiki move', { dryRun: true })).toBe('readonly')
  })

  it('treats install-skills with an explicit --target as host-scoped', () => {
    expect(classifyCliCommand('install-skills', {})).toBe('project')
    expect(classifyCliCommand('install-skills', { target: '/opt/agent' })).toBe('host')
  })

  it('reports an unclassified command instead of guessing a class', () => {
    expect(classifyCliCommand('some future command', {})).toBe('unclassified')
  })
})

describe('automatic interception', () => {
  it('records one receipt for a mutating command with no per-command code', async () => {
    const program = buildProgram(async () => {})

    await program.parseAsync([
      'node',
      'memon',
      '--project-root',
      root,
      'experiment',
      'link',
      'E0001-foo',
      'foo-260901-090000',
    ])

    const records = await readJournalInvocations(root)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      command: 'experiment link',
      origin: 'cli',
      outcome: 'success',
      parameters: { args: ['E0001-foo', 'foo-260901-090000'] },
    })
  })

  it('records a failure receipt when the command is rejected mid-flight', async () => {
    const program = buildProgram(async () => {
      emitErrorAndExit('BAD_REQUEST', 'nope')
    })

    await expect(
      program.parseAsync(['node', 'memon', '--project-root', root, 'experiment', 'link', 'a', 'b']),
    ).rejects.toMatchObject({ exitCode: 2 })

    const records = await readJournalInvocations(root)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ outcome: 'failure', errorCode: 'BAD_REQUEST' })
    expect(records[0]!.finishedAt).not.toBeNull()
  })

  it.each([
    ['read command', ['experiment', 'ls']],
    ['host command', ['serve']],
    ['dry run', ['wiki-migrate', '--dry-run']],
  ])('records nothing for a %s', async (_label, argv) => {
    const program = buildProgram(async () => {})

    await program.parseAsync(['node', 'memon', '--project-root', root, ...argv])

    expect(await readJournalInvocations(root)).toEqual([])
  })

  it('records nothing for an unclassified command and says so', async () => {
    const program = buildProgram(async () => {})

    await program.parseAsync(['node', 'memon', '--project-root', root, 'wiki-migrate'])

    expect(await readJournalInvocations(root)).toEqual([])
    expect(stderrChunks.join('')).toContain('JOURNAL_COMMAND_UNCLASSIFIED')
  })

  it('records into the project the command itself resolves from an implicit cwd', async () => {
    const program = buildProgram(async () => {})

    // No --project-root: the mutation would resolve, and write to, the cwd.
    // The receipt has to land in the same place, not nowhere.
    await program.parseAsync(['node', 'memon', 'experiment', 'link', 'a', 'b'])

    const records = await readJournalInvocations(root)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ command: 'experiment link', outcome: 'success' })
  })

  it('records nothing when no project root can be resolved at all', async () => {
    const program = buildProgram(async () => {})
    const missing = join(root, 'does-not-exist')

    await program.parseAsync([
      'node',
      'memon',
      '--project-root',
      missing,
      'experiment',
      'link',
      'a',
      'b',
    ])

    expect(await readJournalInvocations(root)).toEqual([])
    expect(await readJournalInvocations(missing)).toEqual([])
  })
})
