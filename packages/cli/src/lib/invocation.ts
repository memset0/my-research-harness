// CLI side of the Journal invocation ledger.
//
// The ledger records non-readonly *tool invocations*, so no command author has
// to remember an append call: interception happens once, in Commander's
// pre/post action hooks, driven by the explicit classification table below.
//
// Three classes plus a fail-closed fallback:
//   * `readonly`  — reads, searches, renders, lint. No ledger
//                   effect whatsoever. A mutating command invoked with
//                   `--dry-run` is treated as readonly for the same reason.
//   * `project`   — mutates documents under one project root. Recorded, with
//                   the root resolved exactly as the command itself resolves
//                   it (`loadCliContext`), so a mutation that succeeds always
//                   has a receipt in the project it actually wrote to.
//   * `host`      — manages this machine or its installation (serve, update,
//                   mock seeding). There is no project
//                   whose history it belongs to, and resolving one would record
//                   into whatever directory the operator happened to stand in,
//                   so it is deliberately not recorded. Documented scope, not
//                   a pretend global telemetry store.
//   * unclassified — a command path absent from the table. Not recorded, and
//                   reported on stderr as JOURNAL_COMMAND_UNCLASSIFIED so the
//                   gap is visible instead of being guessed either way.
//
// Exit paths matter more than the happy path here, because `emitErrorAndExit`
// terminates the process synchronously:
//   * success            -> `postAction` hook, async finish
//   * domain error        -> `recordCliInvocationFailureSync` from the emitter,
//                            synchronous finish before `process.exit`
//   * crash / signal      -> `exit` / SIGINT / SIGTERM handler, synchronous
//                            finish as `partial`, never as success
// A finish that cannot be persisted is reported as JOURNAL_RECORD_INCOMPLETE
// and downgrades the exit status; it never rolls back the edit the command
// already made.

import {
  beginJournalInvocation,
  type JournalInvocationHandle,
  type JournalInvocationTerminalOutcome,
  type JournalRecordingFailure,
  loadCliContext,
} from '@memon/core'
import type { Command } from 'commander'
import { EXIT } from './exit-codes.js'

export type CliLedgerClass = 'readonly' | 'project' | 'host'

/**
 * Every registered leaf command path, classified explicitly.
 *
 * A path missing here is a registration that never got classified.
 * `classifyCliCommand` returns `unclassified` for it: nothing is recorded and
 * the gap is reported on stderr. Guessing `project` would file receipts for
 * future pure reads and could attribute machine-level work to a project root;
 * guessing `readonly` would silently lose mutations. Unclassified invocations
 * therefore report the missing classification explicitly.
 */
export const CLI_LEDGER_CLASSES: Readonly<Record<string, CliLedgerClass>> = {
  // ---------- top-level reads ----------
  list: 'readonly',
  show: 'readonly',
  search: 'readonly',
  scan: 'readonly',
  'hypotheses read': 'readonly',
  'hypo list': 'readonly',
  'hypo show': 'readonly',
  'fs-version check': 'readonly',
  // Derived-index cache maintenance and the project declaration: they write
  // only `.memon/index/` or create `.memon/project.yml` for the user to
  // review, and are deliberately never journaled.
  'index status': 'readonly',
  'index compact': 'readonly',
  'index rebuild': 'readonly',
  'project init': 'readonly',
  'project lint': 'readonly',

  // ---------- host / installation management ----------
  serve: 'host',
  'mock seed': 'host',
  update: 'host',

  // ---------- journal ----------
  'journal read': 'readonly',
  'journal submit': 'project',

  // ---------- experiments ----------
  'experiment ls': 'readonly',
  'experiment show': 'readonly',
  'experiment create': 'project',
  'experiment rename': 'project',
  'experiment doc show': 'readonly',
  'experiment doc render': 'readonly',
  'experiment doc lint': 'readonly',
  'experiment implementation show': 'readonly',
  'experiment investigation show': 'readonly',
  'experiment results show': 'readonly',
  'experiment results table': 'readonly',
  'experiment results summary': 'readonly',
  // Writes only `.memon/index/results/` (a rebuildable cache): never journaled.
  'experiment results rebuild': 'readonly',
  'experiment results annotation get': 'readonly',
  'experiment results annotation set': 'project',
  // A dry run without `--apply` (see `classifyCliCommand`).
  'experiment schema upgrade': 'project',
  'experiment section show': 'readonly',
  'experiment link': 'project',
  'experiment unlink': 'project',
  'experiment delete': 'project',
  'experiment status set': 'project',
  'experiment readme write': 'project',
  'experiment archive': 'project',
  'experiment unarchive': 'project',
  'experiment warning add': 'project',
  'experiment warning list': 'readonly',
  'experiment warning resolve': 'project',
  'experiment warning reopen': 'project',
  'experiment warning delete': 'project',

  // ---------- runs ----------
  'run rename': 'project',
  'run result get': 'readonly',
  'run result set': 'project',
  'run result lint': 'readonly',
  'run resolve-exp': 'readonly',
  'run lint': 'readonly',
  'run record': 'project',
  'run archive': 'project',
  'run unarchive': 'project',
  'run deprecate': 'project',
  'run undeprecate': 'project',
  'run status set': 'project',
  'run readme write': 'project',
  'run warning add': 'project',

  // ---------- skills / shares ----------
  'install-skills': 'project',
  'share create': 'project',
  'share list': 'readonly',
  'share revoke': 'project',

  // ---------- wiki ----------
  'wiki ls': 'readonly',
  'wiki show': 'readonly',
  'wiki create': 'project',
  'wiki move': 'project',
  'wiki set': 'project',
  'wiki lint': 'readonly',
  'wiki backlinks': 'readonly',
  'wiki migrate-report': 'project',
  'wiki deprecate': 'project',
  'wiki undeprecate': 'project',
  'wiki delete': 'project',
  'wiki commit': 'project',
  'wiki review log': 'readonly',
  'wiki review diff': 'readonly',
  'wiki review verify': 'project',
  'wiki review unverify': 'project',
  'wiki kinds ls': 'readonly',
  'wiki kinds show': 'readonly',

  // ---------- components ----------
  'components run': 'project',
}

/** `memon experiment warning add` -> `experiment warning add`. */
export function cliCommandPath(command: Command): string {
  const names: string[] = []
  let node: Command | null = command
  while (node !== null && node.parent !== null) {
    names.unshift(node.name())
    node = node.parent
  }
  return names.join(' ')
}

export function classifyCliCommand(
  path: string,
  options: Record<string, unknown>,
): CliLedgerClass | 'unclassified' {
  // `--dry-run` reports what a mutation would do and writes nothing, so it is
  // a read no matter how the command itself is classified.
  if (options.dryRun === true) return 'readonly'
  const declared = CLI_LEDGER_CLASSES[path]
  // Fail closed and LOUD: guessing `project` would file receipts for future
  // pure reads, guessing `readonly` would silently lose mutations. Neither is
  // acceptable, so an unclassified path records nothing and says so.
  if (declared === undefined) return 'unclassified'
  // `install-skills --target <dir>` writes outside project-root semantics.
  if (path === 'install-skills' && typeof options.target === 'string') return 'host'
  // `experiment schema upgrade` writes only with `--apply`; otherwise it is a dry run.
  if (path === 'experiment schema upgrade' && options.apply !== true) return 'readonly'
  return declared
}

let handle: JournalInvocationHandle | null = null
let signalHandlersInstalled = false

export interface BeginCliInvocationInput {
  command: Command
  /** Global `--project-root`, already read from the root program. */
  globalProjectRoot?: string
  cwd: string
  /** Rejected syntax has no safe argument structure to persist. */
  parserFailure?: boolean
}

/**
 * Open a ledger invocation for a mutating command. Called from the root
 * program's `preAction` hook, so a command author cannot forget it.
 *
 * Never fails the command: a project root that cannot be established means
 * there is no history to write into, and the command's own error path reports
 * that far better than a hook could.
 */
export async function beginCliInvocation(input: BeginCliInvocationInput): Promise<void> {
  const path = cliCommandPath(input.command)
  const options = input.command.opts<Record<string, unknown>>()
  const ledgerClass = classifyCliCommand(path, options)
  if (ledgerClass === 'unclassified') {
    process.stderr.write(
      `${JSON.stringify({
        warning: {
          code: 'JOURNAL_COMMAND_UNCLASSIFIED',
          message: `\`memon ${path}\` has no Journal classification, so this invocation is NOT recorded; add it to CLI_LEDGER_CLASSES`,
        },
      })}\n`,
    )
    return
  }
  if (ledgerClass !== 'project') return

  const root = await resolveLedgerRoot(input, options)
  if (root === null) return

  handle = await beginJournalInvocation(
    root,
    {
      command: path,
      origin: 'cli',
      parameters: input.parserFailure ? {} : { args: [...input.command.args], ...options },
    },
    { ambient: true, onRecordingFailure: reportRecordingFailure },
  )
  installProcessGuards()
}

/**
 * Persist the terminal state after a successful action. Called from the root
 * program's `postAction` hook. The action may have marked `noop` / `conflict` /
 * `partial` through the core ambient API; otherwise this is a success.
 *
 * A failed receipt write is not swallowed: the reporter emits the structured
 * JOURNAL_RECORD_INCOMPLETE envelope on stderr and sets a non-zero exit code,
 * so an unrecorded mutation never exits as a plain success.
 */
export async function finishCliInvocation(): Promise<void> {
  // Keep the handle reachable for the process guards while the write is in
  // flight; the handle itself refuses a second terminal write.
  await handle?.finish()
  handle = null
}

/**
 * Record a failing invocation from a synchronous exit path. Must stay
 * synchronous: `emitErrorAndExit` calls `process.exit` on the next line, and an
 * awaited write would never land.
 */
export function recordCliInvocationFailureSync(errorCode: string): void {
  if (handle === null) return
  const outcome: JournalInvocationTerminalOutcome = /CONFLICT/i.test(errorCode)
    ? 'conflict'
    : 'failure'
  handle.finishSync(outcome, errorCode)
  handle = null
}

/** Test seam: drop any ambient handle between cases. */
export function resetCliInvocationForTest(): void {
  handle = null
}

// ---------- internals ----------

function reportRecordingFailure(failure: JournalRecordingFailure): void {
  // A begin-phase failure can still be repaired by the finish write, so it is
  // only a warning. A finish-phase failure means the operation ran without a
  // durable receipt: report it and refuse to exit 0, but never undo the edit
  // just to keep the ledger tidy.
  if (failure.phase === 'finish') process.exitCode = EXIT.GENERIC
  process.stderr.write(
    `${JSON.stringify({
      error: {
        code: 'JOURNAL_RECORD_INCOMPLETE',
        message:
          failure.phase === 'finish'
            ? 'the operation ran but its invocation record could not be persisted; the files it changed were NOT reverted'
            : 'the invocation record could not be opened before the operation ran',
        details: {
          invocationId: failure.invocationId,
          outcome: failure.outcome,
          phase: failure.phase,
          reason: failure.message,
        },
      },
    })}\n`,
  )
}

/**
 * The project root whose history this invocation belongs to, or `null` when
 * none can be established.
 *
 * This MUST be the resolution the mutating command itself performs, not a
 * lookalike: `loadCliContext` with the same `--project-root` / implicit-cwd
 * precedence the commands use through `lib/context.ts`. A heuristic of its own
 * (e.g. "does the cwd look like a project?") would skip receipts for
 * mutations that resolve and succeed anyway, which is the exact hole this
 * ledger exists to close.
 *
 * Resolution failures return `null` instead of throwing: the command's own
 * error path reports them properly, and a hook must not preempt it.
 */
async function resolveLedgerRoot(
  input: BeginCliInvocationInput,
  options: Record<string, unknown>,
): Promise<string | null> {
  const local = typeof options.projectRoot === 'string' ? options.projectRoot : undefined
  try {
    const ctx = await loadCliContext({
      projectRoot: local ?? input.globalProjectRoot,
      cwd: input.cwd,
    })
    // Ambiguity is not attribution: a multi-project context has no single
    // history to write into, and the command will reject it too.
    if (ctx.config.projects.length !== 1) return null
    return ctx.config.projects[0]!.root
  } catch {
    return null
  }
}

/**
 * Last-resort guards. Any exit path that is neither the postAction hook nor a
 * structured error emitter — an uncaught `process.exit` deep in a command, a
 * Ctrl-C, a `kill` — leaves the record as `partial`, which is exactly what it
 * is: the operation may have changed some files before it stopped.
 */
function installProcessGuards(): void {
  if (signalHandlersInstalled) return
  signalHandlersInstalled = true
  process.on('exit', () => {
    handle?.finishSync('partial', 'INTERRUPTED')
  })
  for (const [signal, code] of [
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const) {
    process.once(signal, () => {
      handle?.finishSync('partial', signal)
      process.exit(code)
    })
  }
}
