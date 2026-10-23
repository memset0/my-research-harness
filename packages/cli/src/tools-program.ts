import type { Command } from 'commander'
import { runComponentsRun } from './commands/components.js'
import { runJournalRead } from './commands/journal.js'
import { runMockSeed } from './commands/mock.js'
import { runServe } from './commands/serve.js'
import { runUpdate, updateFailed } from './commands/update.js'
import { runWikiCreate, runWikiDelete, runWikiMove } from './commands/wiki.js'
import { emitErrorAndExit } from './lib/emit-error.js'
import { EXIT } from './lib/exit-codes.js'
import { readGlobalsFor } from './lib/program.js'

export function registerToolsCommands(program: Command): void {
  const readGlobals = () => readGlobalsFor(program)

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
    .option(
      '--config <path>',
      'path to config.yml (default: <cwd>/config.yml or <repo-root>/config.yml)',
    )
    .option('--dev', 'run Next.js in dev mode', false)
    .option('-p, --port <port>', 'override the configured port (standalone default: 3737)')
    .action(async (opts: { config?: string; dev?: boolean; port?: string }) => {
      const g = readGlobals()
      if (g.projectRoot) {
        emitErrorAndExit(
          'BAD_REQUEST',
          '--project-root is not supported by `memon serve`; use config.yml',
        )
      }
      const port = opts.port === undefined ? undefined : Number(opts.port)
      if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65_535)) {
        emitErrorAndExit('BAD_REQUEST', '--port must be an integer between 1 and 65535')
      }
      await runServe({
        configPath: opts.config,
        cwd: g.cwd,
        dev: !!opts.dev,
        ...(port !== undefined ? { port } : {}),
      })
    })

  program
    .command('update')
    .description(
      'fast-forward this installation from its configured trusted upstream, rebuild the CLI, and refresh managed skills',
    )
    .option(
      '--source <path>',
      'source checkout to update (default: the checkout this CLI runs from)',
    )
    .option('--remote <name>', 'configured remote name (default: the branch upstream remote)')
    .option('--branch <name>', 'upstream branch name (default: the branch upstream merge ref)')
    .option(
      '--skills-root <path>',
      'refresh managed skills under this project root (repeatable; default: cwd)',
      (value: string, previous: string[]) => [...previous, value],
      [] as string[],
    )
    .option('--no-skills', 'skip the managed-skill refresh')
    .option('--dry-run', 'report the selected revision and planned actions, change nothing', false)
    .action(
      async (opts: {
        source?: string
        remote?: string
        branch?: string
        skillsRoot: string[]
        skills?: boolean
        dryRun?: boolean
      }) => {
        const g = readGlobals()
        if (g.projectRoot) {
          emitErrorAndExit(
            'BAD_REQUEST',
            '--project-root is not supported by `memon update`; use --skills-root',
          )
        }
        const result = await runUpdate({
          cwd: g.cwd,
          format: g.format,
          ...(opts.source ? { source: opts.source } : {}),
          ...(opts.remote ? { remote: opts.remote } : {}),
          ...(opts.branch ? { branch: opts.branch } : {}),
          skillsRoots: opts.skillsRoot,
          skills: opts.skills !== false,
          dryRun: opts.dryRun === true,
        })
        if (updateFailed(result)) process.exitCode = EXIT.GENERIC
      },
    )

  const journal = program
    .command('journal')
    .description('diagnostic invocation history and direct-maintenance submission')

  journal
    .command('read')
    .description(
      'explicit diagnostic query over merged Journal history: preserved legacy docs/journal.md lines plus typed invocation receipts. Not a research input: no manual append and no digest cursor.',
    )
    .option('--since <iso>', 'only events at/after this ISO8601 instant (offset required)')
    .option('--tag <tag>', 'only events carrying this tag (e.g. STATUS / BIND / INVOCATION)')
    .option(
      '--experiment-id <id>',
      'only events associated with this experiment (E<NNNN>[-<slug>])',
    )
    .option('--run-id <id>', 'only events associated with this run (<slug>-<YYMMDD>-<HHMMSS>)')
    .option('--origin <origin>', 'legacy | invocation')
    .option(
      '--outcome <outcome>',
      'only invocation receipts with this outcome: running | success | failure | conflict | noop | partial',
    )
    .option('--limit <n>', 'cap returned events (default 200, max 1000)')
    .option('--cursor <cursor>', "opaque cursor from a previous read's nextCursor")
    .action(
      async (opts: {
        since?: string
        tag?: string
        experimentId?: string
        runId?: string
        origin?: string
        outcome?: string
        limit?: string
        cursor?: string
      }) => {
        const g = readGlobals()
        await runJournalRead({ ...g, ...opts })
      },
    )

  const components = program
    .command('components')
    .description('document component blocks (docs under the project root)')

  components
    .command('run <document>')
    .description("execute a document's executable component blocks and cache the results")
    .option('--project-root <path>', 'use <path> as the only project (default: cwd)')
    .option('--format <fmt>', 'output format: json | human')
    .option('--id <id>', 'only run this block id (repeatable)', collectOption, [])
    .action(
      async (document: string, opts: { projectRoot?: string; format?: string; id?: string[] }) => {
        const global = program.opts<{ projectRoot?: string; format?: string }>()
        await runComponentsRun({
          document,
          ids: opts.id,
          projectRoot: opts.projectRoot ?? global.projectRoot,
          cwd: process.cwd(),
          format: opts.format ?? global.format,
        })
      },
    )

  const wiki = program
    .command('wiki')
    .description('wiki commands (docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md})')

  interface WikiLocalOptions {
    projectRoot?: string
    format?: string
  }

  function wikiCommand(
    parent: Command,
    spec: string,
    description: string,
    markdown = false,
  ): Command {
    return parent
      .command(spec)
      .description(description)
      .option('--project-root <path>', 'use <path> as the only project (default: cwd)')
      .option(
        '--format <fmt>',
        markdown ? 'output format: json | human | markdown' : 'output format: json | human',
      )
  }

  function wikiGlobals(opts: WikiLocalOptions): {
    projectRoot?: string
    cwd: string
    format?: string
  } {
    const global = program.opts<{ projectRoot?: string; format?: string }>()
    return {
      projectRoot: opts.projectRoot ?? global.projectRoot,
      cwd: process.cwd(),
      format: opts.format ?? global.format,
    }
  }

  function collectOption(value: string, previous: string[]): string[] {
    return [...previous, value]
  }

  wikiCommand(wiki, 'create <kind> <slug>', 'allocate the next W<NNNN> in a category folder')
    .requiredOption('--title <text>', 'page title (also the H1)')
    .option('--description <text>', 'one to three sentences that stand alone in a listing')
    .option('--status <status>', 'optional declared status')
    .option('--date <YYYY-MM-DD>', 'optional event date')
    .option(
      '--source <artifact>',
      'cite an Experiment / Variant / run (repeatable)',
      collectOption,
      [],
    )
    .option('--tag <tag>', 'add a tag (repeatable)', collectOption, [])
    .option('--language <en|zh>', 'content language of the page (default: en)')
    .option('--bundle', 'create a folder with README.md (default)', true)
    .option('--no-bundle', 'create a legacy standalone Markdown file')
    .action(
      async (
        kind: string,
        slug: string,
        opts: WikiLocalOptions & {
          title: string
          description?: string
          status?: string
          date?: string
          source?: string[]
          tag?: string[]
          language?: string
          bundle?: boolean
        },
      ) => {
        await runWikiCreate({ ...wikiGlobals(opts), ...opts, kind, slug })
      },
    )

  wikiCommand(wiki, 'move <page> <target>', 'relocate a page to <kind> or <kind>/<slug>')
    .option('--status <status>', 'status to adopt for the new kind')
    .action(async (page: string, target: string, opts: WikiLocalOptions & { status?: string }) => {
      await runWikiMove({ ...wikiGlobals(opts), page, target, status: opts.status })
    })

  wikiCommand(wiki, 'delete <page>', 'delete an unreferenced Wiki page and its owned assets')
    .addHelpText(
      'after',
      '\nReference checks cover docs/experiments, docs/wiki and docs/reports only; Experiment caches and execution outputs are excluded.',
    )
    .action(async (page: string, opts: WikiLocalOptions) => {
      await runWikiDelete({ ...wikiGlobals(opts), page })
    })
}
