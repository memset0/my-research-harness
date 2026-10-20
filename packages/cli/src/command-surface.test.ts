import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import type { Command } from 'commander'
import { afterEach, expect, it, vi } from 'vitest'
import { CLI_LEDGER_CLASSES, resetCliInvocationForTest } from './lib/invocation.js'
import { parseProgram } from './lib/program.js'
import { createResearchProgram } from './research-program.js'
import { captureCli } from './test-support/results-project.js'

afterEach(async () => {
  resetCliInvocationForTest()
  vi.restoreAllMocks()
  await removeTempDirs()
})

function leaves(program: Command, prefix = ''): string[] {
  return program.commands
    .flatMap((command) => {
      const path = `${prefix}${command.name()}`
      return command.commands.length ? leaves(command, `${path} `) : [path]
    })
    .sort()
}

it('keeps all 32 retained commands in one memon tree without duplicate groups', async () => {
  const program = createResearchProgram()
  const registered = leaves(program)
  const expected = [
    'experiment create',
    'install-skills',
    'refresh',
    'run create',
    'run update',
    'show',
    'components run',
    'experiment migrate',
    'journal read',
    'mock seed',
    'serve',
    'share create',
    'share list',
    'share revoke',
    'update',
    'wiki create',
    'wiki migrate-report',
    'wiki move',
    'experiment archive',
    'experiment link',
    'experiment schema upgrade',
    'experiment unarchive',
    'experiment unlink',
    'experiment variant deprecate',
    'experiment variant restore',
    'experiment version advance',
    'experiment version import',
    'experiment version show',
    'run archive',
    'run record',
    'run rename',
    'run unarchive',
  ]
  expect(program.name()).toBe('memon')
  expect(registered).toEqual(expected.sort())
  expect(Object.keys(CLI_LEDGER_CLASSES).sort()).toEqual(registered)
  const uniqueGroups = (command: Command) => {
    const names = command.commands.map((child) => child.name())
    expect(new Set(names).size).toBe(names.length)
    for (const child of command.commands) uniqueGroups(child)
  }
  uniqueGroups(program)
  const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'))
  expect(pkg.bin).toEqual({ memon: './dist/index.js' })
})

it('shares root options and invocation handling across routine, optional and legacy commands', async () => {
  const project = await createTempProject()
  const cli = (format: string, ...args: string[]) =>
    captureCli(() =>
      parseProgram(createResearchProgram(), [
        'node',
        'memon',
        '--project-root',
        project.root,
        '--format',
        format,
        ...args,
      ]),
    )
  expect((await cli('json', 'experiment', 'create', 'study')).exitCode).toBe(0)
  const wiki = await cli('human', 'wiki', 'create', 'note', 'summary', '--title', 'Summary')
  expect(wiki.exitCode, wiki.stderr).toBe(0)
  expect(wiki.stdout).toContain('W0001')
  expect(wiki.stdout.trim()).not.toMatch(/^\{/)
  expect(await fs.readFile(project.path('docs/wiki/note/W0001-summary.md'), 'utf8')).toContain(
    'Summary',
  )
  const legacyRead = await cli('json', 'experiment', 'version', 'show', 'E0001')
  expect(legacyRead.exitCode, legacyRead.stderr).toBe(0)
  expect(legacyRead.json.mode).toBe('lightweight')
  const invalid = await cli('invalid', 'experiment', 'version', 'show', 'E0001')
  expect(invalid.exitCode).not.toBe(0)
  expect(invalid.stderr).toContain('--format must be json or human')
})

it.each([
  'serve',
  'update',
])('offers %s help on memon without starting the action', async (name) => {
  const result = await captureCli(() =>
    parseProgram(createResearchProgram(), ['node', 'memon', name, '--help']),
  )
  expect(result.exitCode).toBe(0)
  expect(result.stdout).toContain(`memon ${name}`)
})

it.each([
  ['run', 'result', 'set', 'trial', 'metrics.loss=1'],
  ['experiment', 'variant', 'create', 'E0001'],
  ['wiki', 'commit'],
  ['journal', 'submit', '--files', 'README.md'],
  ['list'],
])('rejects removed invocation %j before touching the project', async (...args) => {
  const project = await createTempProject()
  const program = createResearchProgram()
  const intercept = (command: Command) => {
    command.exitOverride().configureOutput({ writeErr: () => {} })
    for (const child of command.commands) intercept(child)
  }
  intercept(program)
  await expect(
    program.parseAsync(['--project-root', project.root, ...args], { from: 'user' }),
  ).rejects.toBeDefined()
  expect(await fs.readdir(project.root)).toEqual([])
})
