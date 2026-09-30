import { Command, CommanderError } from 'commander'
import { describe, expect, it } from 'vitest'
import { commanderExitCode, EXIT, exitCodeForErrorCode } from './exit-codes.js'

function parseFailure(argv: string[]): CommanderError {
  const program = new Command().name('memon').exitOverride()
  program.configureOutput({ writeErr: () => {}, writeOut: () => {} })
  program
    .command('show <id>')
    .option('--format <f>', 'format')
    .action(() => {})
  try {
    program.parse(['node', 'memon', ...argv])
  } catch (err) {
    if (err instanceof CommanderError) return err
    throw err
  }
  throw new Error('expected a Commander failure')
}

describe('Commander parse failures', () => {
  it.each([
    ['unknown option', ['show', 'x', '--bogus']],
    ['missing argument', ['show']],
    ['unknown command', ['nope']],
  ])('exit 2 for %s, like the BAD_REQUEST the receipt records', (_label, argv) => {
    const err = parseFailure(argv)
    expect(err.exitCode).not.toBe(0)
    expect(commanderExitCode(err.exitCode)).toBe(EXIT.USAGE)
    expect(commanderExitCode(err.exitCode)).toBe(exitCodeForErrorCode('BAD_REQUEST'))
  })

  it('keeps help and version at exit 0', () => {
    expect(commanderExitCode(parseFailure(['--help']).exitCode)).toBe(EXIT.SUCCESS)
  })
})
