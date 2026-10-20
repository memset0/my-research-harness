import { ConfigError, MEMON_RELEASE, ProjectDeclarationError } from '@memon/core'
import { Command, CommanderError } from 'commander'
import { parseRunDirs, setRunDirs } from './discovery-options.js'
import { emitErrorAndExit, emitGenericAndExit } from './emit-error.js'
import { commanderExitCode, EXIT } from './exit-codes.js'
import {
  beginCliInvocation,
  finishCliInvocation,
  recordCliInvocationFailureSync,
} from './invocation.js'

export interface Globals {
  projectRoot?: string
  format: 'json' | 'human'
  cwd: string
}

export function readGlobalsFor(program: Command): Globals {
  const opts = program.opts<{ projectRoot?: string; format?: string }>()
  return {
    projectRoot: opts.projectRoot,
    format: opts.format === 'human' ? 'human' : 'json',
    cwd: process.cwd(),
  }
}

export function createProgram(): Command {
  return new Command()
    .name('memon')
    .description('create research records, publish file edits and read evidence')
    .version(MEMON_RELEASE)
    .option('--project-root <path>', 'project root (default: cwd)')
    .option('--format <fmt>', 'output format: json | human', 'json')
    .option(
      '--run-dir <pattern>',
      'override declared Run locations (repeatable)',
      (value: string, previous: string[] = []) => [...previous, value],
    )
    .addHelpText(
      'after',
      '\nSix routine commands: experiment create, run create, run update, refresh, show, install-skills.\nEdit Markdown, JSON and CSV directly; memon refresh publishes edits.\nAll 19 retained commands use memon; migration scripts live in packages/core/migrations/.',
    )
}

/** Shared error/lock handling for all registered commands. */
export async function parseProgram(program: Command, argv = process.argv): Promise<void> {
  let parsingCommand = program
  let actionStarted = false
  program.hook('preAction', async (_parent, actionCommand) => {
    const options = program.opts<{ projectRoot?: string; runDir?: string[]; format?: string }>()
    if (!['json', 'human'].includes(options.format ?? 'json'))
      emitErrorAndExit('BAD_REQUEST', '--format must be json or human')
    const runDirs = parseRunDirs(options.runDir)
    if (runDirs.error !== undefined) emitErrorAndExit('BAD_REQUEST', runDirs.error)
    setRunDirs(runDirs.runDirs)
    actionStarted = true
    await beginCliInvocation({
      command: actionCommand,
      globalProjectRoot: options.projectRoot,
      cwd: process.cwd(),
    })
  })
  program.hook('postAction', finishCliInvocation)
  const intercept = (command: Command): void => {
    command.exitOverride()
    command.hook('preSubcommand', (_parent, child) => {
      parsingCommand = child
    })
    for (const child of command.commands) intercept(child)
  }
  intercept(program)
  try {
    if (argv.length <= 2) {
      program.outputHelp()
      return
    }
    await program.parseAsync(argv)
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode !== 0 && parsingCommand.commands.length === 0 && actionStarted)
        recordCliInvocationFailureSync('BAD_REQUEST')
      process.exit(commanderExitCode(error.exitCode))
    }
    if (error instanceof ProjectDeclarationError)
      emitErrorAndExit('BAD_REQUEST', error.message, {
        code: error.code,
        file: error.file,
        ...(error.key === undefined ? {} : { field: error.key }),
      })
    if (error instanceof ConfigError) {
      process.stderr.write(`${JSON.stringify({ error: { message: error.message } })}\n`)
      process.exit(EXIT.GENERIC)
    }
    emitGenericAndExit(error)
  }
}
