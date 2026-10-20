import { promises as fs } from 'node:fs'
import { createTempProject, removeTempDirs } from '@memon/test-utils'
import type { Command } from 'commander'
import { afterEach, expect, it } from 'vitest'
import { createLegacyProgram } from './legacy-program.js'
import { CLI_LEDGER_CLASSES } from './lib/invocation.js'
import { createResearchProgram } from './research-program.js'
import { createToolsProgram } from './tools-program.js'

afterEach(removeTempDirs)

function leaves(program: Command, prefix = ''): string[] {
  return program.commands
    .flatMap((command) => {
      const path = `${prefix}${command.name()}`
      return command.commands.length ? leaves(command, `${path} `) : [path]
    })
    .sort()
}

it('registers only the agreed normal, optional and compatibility surfaces', () => {
  const normal = leaves(createResearchProgram())
  const tools = leaves(createToolsProgram())
  const legacy = leaves(createLegacyProgram())
  expect(normal).toEqual([
    'experiment create',
    'install-skills',
    'refresh',
    'run create',
    'run update',
    'show',
  ])
  expect(tools).toEqual([
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
  ])
  expect(legacy).toEqual([
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
  ])
  expect(Object.keys(CLI_LEDGER_CLASSES).sort()).toEqual([...normal, ...tools, ...legacy].sort())
})

it.each([
  ['run', 'result', 'set', 'trial', 'metrics.loss=1'],
  ['experiment', 'variant', 'create', 'E0001'],
  ['wiki', 'commit'],
  ['journal', 'submit', '--files', 'README.md'],
  ['list'],
  ['serve'],
])('rejects removed or relocated invocation %j before touching the project', async (...args) => {
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
