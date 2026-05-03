#!/usr/bin/env node
// @memon/cli — `memon` command-line tool entry point.
//
// Subcommands: serve / list / show / search / new / hypo / mock.
// Globals: --config <path>, --format <json|human>.

import { Command } from 'commander'
import { ConfigError } from '@memon/core'
import { runList } from './commands/list.js'
import { runShow } from './commands/show.js'
import { runSearch } from './commands/search.js'
import { runNew } from './commands/new.js'
import { runHypoList, runHypoShow } from './commands/hypo.js'
import { runMockSeed } from './commands/mock.js'
import { runServe } from './commands/serve.js'

const program = new Command()
program
  .name('memon')
  .description('experiment monitoring and management')
  .version('0.0.0')
  .option('--config <path>', 'path to config.yml (defaults to <cwd>/config.yml)')
  .option('--format <fmt>', 'output format: json | human', 'json')

function readGlobals() {
  const opts = program.opts<{ config?: string; format?: string }>()
  const format = opts.format === 'human' ? 'human' : 'json'
  return { configPath: opts.config, format: format as 'json' | 'human', cwd: process.cwd() }
}

program
  .command('list')
  .description('list experiments across configured projects')
  .option('--project <name>', 'restrict to a single project')
  .action(async (opts: { project?: string }) => {
    const g = readGlobals()
    await runList({ ...g, project: opts.project })
  })

program
  .command('show <id>')
  .description('show a single experiment by directory id')
  .action(async (id: string) => {
    const g = readGlobals()
    await runShow({ ...g, id })
  })

program
  .command('search <query>')
  .description('substring search across experiments')
  .option('--in <scope>', 'search scope: all | body | fm', 'all')
  .action(async (query: string, opts: { in?: string }) => {
    const g = readGlobals()
    const scope = opts.in === 'body' ? 'body' : opts.in === 'fm' ? 'fm' : 'all'
    await runSearch({ ...g, query, scope })
  })

program
  .command('new <name>')
  .description('create a new experiment scaffold')
  .option('--project <name>', 'target project (defaults to first)')
  .action(async (name: string, opts: { project?: string }) => {
    const g = readGlobals()
    await runNew({ ...g, name, project: opts.project })
  })

const hypo = program.command('hypo').description('hypothesis registry commands')
hypo
  .command('list')
  .description('list hypotheses across projects')
  .option('--project <name>', 'restrict to a single project')
  .action(async (opts: { project?: string }) => {
    const g = readGlobals()
    await runHypoList({ ...g, project: opts.project })
  })
hypo
  .command('show <id>')
  .description('show a single hypothesis by id (e.g. H3)')
  .option('--project <name>', 'restrict to a single project')
  .action(async (id: string, opts: { project?: string }) => {
    const g = readGlobals()
    await runHypoShow({ ...g, id, project: opts.project })
  })

const mock = program.command('mock').description('manage mock data fixtures')
mock
  .command('seed')
  .description('copy in-repo mock/ into a writable runtime location')
  .option('--force', 'overwrite the runtime location if it exists', false)
  .action(async (opts: { force?: boolean }) => {
    const g = readGlobals()
    await runMockSeed({ ...g, force: !!opts.force })
  })

program
  .command('serve')
  .description('run the web dashboard (Next.js) on the configured port')
  .option('--dev', 'run Next.js in dev mode', false)
  .option('-p, --port <port>', 'port to bind (default 3737)', '3737')
  .action(async (opts: { dev?: boolean; port?: string }) => {
    const g = readGlobals()
    await runServe({
      configPath: g.configPath,
      cwd: g.cwd,
      dev: !!opts.dev,
      port: Number(opts.port) || 3737,
    })
  })

async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`memon: ${err.message}\n`)
      process.exit(1)
    }
    process.stderr.write(`memon: ${(err as Error).message}\n`)
    process.exit(1)
  }
}

void main()
