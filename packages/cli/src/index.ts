#!/usr/bin/env node

// @memon/cli — `memon` command-line tool entry point.

import {
  ConfigError,
  EXPERIMENT_DIR_REGEX,
  MEMON_RELEASE,
  ProjectDeclarationError,
  RUN_DIR_REGEX,
} from '@memon/core'
import { Command, CommanderError } from 'commander'
import { runComponentsRun } from './commands/components.js'
import { runIndexCompact, runIndexRebuild, runIndexStatus } from './commands/derived-index.js'
import {
  readStdin,
  runArchive,
  runReadmeWrite,
  runStatusSet,
  runUnarchive,
} from './commands/experiment.js'
import {
  runExperimentArchiveDoc,
  runExperimentCreate,
  runExperimentDelete,
  runExperimentLink,
  runExperimentLs,
  runExperimentShow,
  runExperimentStatusSet,
  runExperimentUnarchiveDoc,
  runExperimentUnlink,
} from './commands/experiment-doc.js'
import {
  runExperimentDocumentLint,
  runExperimentDocumentRender,
  runExperimentDocumentShow,
} from './commands/experiment-document.js'
import { runExperimentRename } from './commands/experiment-rename.js'
import { runFsVersionCheck } from './commands/fs-version-check.js'
import { runHypoList, runHypoShow } from './commands/hypo.js'
import { runHypothesesRead } from './commands/hypotheses.js'
import { parseAgentList, runInstallSkills } from './commands/install-skills.js'
import { runJournalRead } from './commands/journal.js'
import { runJournalSubmit } from './commands/journal-submit.js'
import { runList } from './commands/list.js'
import { runMockSeed } from './commands/mock.js'
import { runProjectInit, runProjectLint } from './commands/project.js'
import {
  registerExperimentResultsCommands,
  registerRunResultCommands,
} from './commands/results-commands.js'
import { runRunDeprecate, runRunUndeprecate } from './commands/run-deprecate.js'
import { runRunLint } from './commands/run-lint.js'
import { runRunRecord } from './commands/run-record.js'
import { runRunRename } from './commands/run-rename.js'
import { runResolveExp } from './commands/run-resolve-exp.js'
import { runRunWarningAdd } from './commands/run-warning.js'
import { runScan } from './commands/scan.js'
import { runSearch } from './commands/search.js'
import { runServe } from './commands/serve.js'
import { runShareCreate, runShareList, runShareRevoke } from './commands/share.js'
import { runShow } from './commands/show.js'
import { runUpdate, updateFailed } from './commands/update.js'
import {
  runWarningAdd,
  runWarningDelete,
  runWarningList,
  runWarningReopen,
  runWarningResolve,
} from './commands/warning.js'
import {
  runWikiBacklinks,
  runWikiCommit,
  runWikiCreate,
  runWikiDelete,
  runWikiDeprecate,
  runWikiLint,
  runWikiLs,
  runWikiMigrateReport,
  runWikiMove,
  runWikiReviewDiff,
  runWikiReviewLog,
  runWikiReviewUnverify,
  runWikiReviewVerify,
  runWikiSet,
  runWikiShow,
  runWikiUndeprecate,
} from './commands/wiki.js'
import { emitWarningDeprecationBanner } from './lib/deprecations.js'
import { parseRunDirs, setRunDirs } from './lib/discovery-options.js'
import { emitErrorAndExit, emitGenericAndExit } from './lib/emit-error.js'
import { commanderExitCode, EXIT } from './lib/exit-codes.js'
import {
  beginCliInvocation,
  finishCliInvocation,
  recordCliInvocationFailureSync,
} from './lib/invocation.js'

const program = new Command()
program
  .name('memon')
  .description('experiment monitoring and management')
  .version(MEMON_RELEASE)
  .option('--project-root <path>', 'use <path> as the only project (default: cwd)')
  .option('--format <fmt>', 'output format: json | human', 'json')
  .option(
    '--run-dir <pattern>',
    'declare where Run directories live, e.g. logs/* or outputs/*/* (repeatable; overrides .memon/project.yml; default: logs/*, outputs/*, experiments/*)',
    (value: string, previous: string[] = []) => [...previous, value],
  )

let parsingCommand = program
let actionStarted = false
// Journal invocation ledger. Interception lives here, once, so no command
// author has to remember to record anything: `lib/invocation.ts` classifies
// the resolved command path and only records non-readonly, project-scoped
// ones. Error and signal exits are flushed from the emitters and the process
// guards, because `emitErrorAndExit` never returns to this hook.
program.hook('preAction', async (_thisCommand, actionCommand) => {
  // Validated before anything reads the project, including the ledger.
  const runDirs = parseRunDirs(program.opts<{ runDir?: string[] }>().runDir)
  if (runDirs.error !== undefined) emitErrorAndExit('BAD_REQUEST', runDirs.error)
  setRunDirs(runDirs.runDirs)
  actionStarted = true
  await beginCliInvocation({
    command: actionCommand,
    globalProjectRoot: program.opts<{ projectRoot?: string }>().projectRoot,
    cwd: process.cwd(),
  })
})
program.hook('postAction', async () => {
  await finishCliInvocation()
})

interface Globals {
  projectRoot?: string
  format: 'json' | 'human'
  cwd: string
}

function readGlobals(): Globals {
  const opts = program.opts<{ projectRoot?: string; format?: string }>()
  const format = opts.format === 'human' ? 'human' : 'json'
  return {
    projectRoot: opts.projectRoot,
    format,
    cwd: process.cwd(),
  }
}

/**
 * Deprecation is orthogonal to archival: a run may be archived, deprecated,
 * both, or neither, so the two flag pairs are validated independently.
 * Deprecated runs are excluded from every enumerating read by default;
 * `--include-deprecated` / `--deprecated-only` are the explicit inspection
 * paths, and explicit-id lookups (`show`, `run *`) are never filtered.
 */
function assertDeprecationFlags(opts: {
  includeDeprecated?: boolean
  deprecatedOnly?: boolean
}): void {
  if (opts.includeDeprecated && opts.deprecatedOnly) {
    emitErrorAndExit(
      'BAD_REQUEST',
      '--include-deprecated and --deprecated-only are mutually exclusive',
    )
  }
}

// ---------- read commands (existing) ----------

program
  .command('list')
  .description('list experiments across configured projects')
  .option('--project <name>', 'restrict to a single project')
  .option('--include-deprecated', 'also list runs marked deprecated', false)
  .option('--deprecated-only', 'list ONLY runs marked deprecated', false)
  .action(
    async (opts: { project?: string; includeDeprecated?: boolean; deprecatedOnly?: boolean }) => {
      const g = readGlobals()
      if (g.projectRoot && opts.project) {
        emitErrorAndExit('BAD_REQUEST', '--project-root cannot be combined with --project')
      }
      assertDeprecationFlags(opts)
      await runList({
        ...g,
        project: opts.project,
        includeDeprecated: !!opts.includeDeprecated,
        deprecatedOnly: !!opts.deprecatedOnly,
      })
    },
  )

program
  .command('show <id>')
  .description(
    'show a single experiment by directory id. Explicit-id inspection: resolves archived and deprecated runs too, carrying their markers.',
  )
  .action(async (id: string) => {
    const g = readGlobals()
    await runShow({ ...g, id })
  })

program
  .command('search <query>')
  .description('substring search across experiments')
  .option('--in <scope>', 'search scope: all | body | fm', 'all')
  .option('--include-deprecated', 'also match runs marked deprecated', false)
  .option('--deprecated-only', 'match ONLY runs marked deprecated', false)
  .action(
    async (
      query: string,
      opts: { in?: string; includeDeprecated?: boolean; deprecatedOnly?: boolean },
    ) => {
      const g = readGlobals()
      const scope = opts.in === 'body' ? 'body' : opts.in === 'fm' ? 'fm' : 'all'
      assertDeprecationFlags(opts)
      await runSearch({
        ...g,
        query,
        scope,
        includeDeprecated: !!opts.includeDeprecated,
        deprecatedOnly: !!opts.deprecatedOnly,
      })
    },
  )

const hypo = program.command('hypo').description('hypothesis registry commands (human-friendly)')
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
  .description('show a single hypothesis by id (e.g. H0003)')
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
  .option('--source <path>', 'source checkout to update (default: the checkout this CLI runs from)')
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

// ---------- new agent-shaped read commands ----------

program
  .command('scan [project-root]')
  .description('bulk-read a project root: experiments + hypotheses')
  .option('--include-archived', 'include archived runs in the result', false)
  .option('--archived-only', 'return ONLY archived runs', false)
  .option('--include-deprecated', 'include runs marked deprecated in the result', false)
  .option('--deprecated-only', 'return ONLY runs marked deprecated', false)
  .action(
    async (
      positionalRoot: string | undefined,
      opts: {
        includeArchived?: boolean
        archivedOnly?: boolean
        includeDeprecated?: boolean
        deprecatedOnly?: boolean
      },
    ) => {
      const g = readGlobals()
      if (opts.includeArchived && opts.archivedOnly) {
        emitErrorAndExit(
          'BAD_REQUEST',
          '--include-archived and --archived-only are mutually exclusive',
        )
      }
      assertDeprecationFlags(opts)
      const root = positionalRoot ?? g.projectRoot ?? g.cwd
      await runScan({
        projectRoot: root,
        includeArchived: !!opts.includeArchived,
        archivedOnly: !!opts.archivedOnly,
        includeDeprecated: !!opts.includeDeprecated,
        deprecatedOnly: !!opts.deprecatedOnly,
        format: g.format,
      })
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
  .option('--experiment-id <id>', 'only events associated with this experiment (E<NNNN>[-<slug>])')
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
journal
  .command('submit')
  .description(
    'record a direct-maintenance receipt for managed Experiment / Wiki files you edited yourself. Verifies paths and records current digests without modifying submitted documents. Carries no prose and is not a git commit.',
  )
  .requiredOption(
    '--files <paths...>',
    'project-root-relative paths under docs/experiments/E<NNNN>-<slug>/ or docs/wiki/',
  )
  .action(async (opts: { files: string[] }) => {
    const g = readGlobals()
    await runJournalSubmit({ ...g, files: opts.files })
  })

program
  .command('hypotheses')
  .description('hypotheses commands (agent-shaped JSON output)')
  .addCommand(
    new Command('read').description('read parsed docs/hypotheses.md (JSON)').action(async () => {
      const g = readGlobals()
      await runHypothesesRead(g)
    }),
  )

const experiment = program
  .command('experiment')
  .description('experiment-doc commands (docs/experiments/E<NNNN>-<slug>/README.md)')

experiment
  .command('ls')
  .description('list experiment docs in the project')
  .action(async () => {
    const g = readGlobals()
    await runExperimentLs(g)
  })

experiment
  .command('show <id-or-slug>')
  .description('show a single experiment doc by id or slug')
  .action(async (idOrSlug: string) => {
    const g = readGlobals()
    await runExperimentShow({ ...g, idOrSlug })
  })

experiment
  .command('create <slug>')
  .description(
    'allocate next E<NNNN> and write docs/experiments/E<NNNN>-<slug>/ (README.md, implementation.yaml, investigation.yaml, experiment.json)',
  )
  .option('--title <text>', 'human-readable title')
  .option('--hypotheses <list>', 'comma-separated H<NNNN> ids')
  .option(
    '--from-run <run-dir>',
    'declare an existing run (project-relative path or unique id) as the first member',
  )
  .action(async (slug: string, opts: { title?: string; hypotheses?: string; fromRun?: string }) => {
    const g = readGlobals()
    const hyps = opts.hypotheses
      ? opts.hypotheses
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      : []
    await runExperimentCreate({
      ...g,
      slug,
      title: opts.title,
      hypotheses: hyps,
      fromRun: opts.fromRun,
    })
  })

experiment
  .command('rename <id-or-slug> <new-slug>')
  .description(
    "rename an experiment's slug (NNNN preserved); updates hypotheses.md, member run paths stay valid",
  )
  .action(async (idOrSlug: string, newSlug: string) => {
    const g = readGlobals()
    await runExperimentRename({ ...g, idOrSlug, newSlug })
  })

const experimentDoc = experiment
  .command('doc')
  .description(
    'read, render and lint the Experiment document package (README, implementation.yaml, investigation.yaml, experiment.json, member result.csv files)',
  )
experimentDoc
  .command('show <id-or-slug> <section>')
  .description('show normalized implementation, investigation, or results data')
  .action(async (idOrSlug: string, section: string) => {
    await runExperimentDocumentShow({ ...readGlobals(), idOrSlug, section })
  })
experimentDoc
  .command('render <id-or-slug> <section>')
  .description('render a managed section as human-readable Markdown')
  .action(async (idOrSlug: string, section: string) => {
    await runExperimentDocumentRender({ ...readGlobals(), idOrSlug, section })
  })
experimentDoc
  .command('lint <id-or-slug>')
  .description(
    'lint the Experiment document package for format and structure: README sections, managed pointers, YAML schemas, experiment.json, cross-references and every member result.csv (version, duplicates, declared types, RESULT_FILE_IGNORED). Includes the schema validation that `doc validate` used to perform. Never judges research state.',
  )
  .action(async (idOrSlug: string) => {
    await runExperimentDocumentLint({ ...readGlobals(), idOrSlug })
  })

// Read-only convenience forms kept deliberately small: Agents edit the YAML
// files directly; these commands are projections, never CRUD APIs.
for (const section of ['implementation', 'investigation'] as const) {
  const sectionCommand = experiment.command(section).description(`${section}.yaml read commands`)
  sectionCommand
    .command('show <id-or-slug>')
    .description(`render ${section}.yaml as human-readable Markdown or normalized JSON`)
    .action(async (idOrSlug: string) => {
      await runExperimentDocumentShow({ ...readGlobals(), idOrSlug, section })
    })
}
registerExperimentResultsCommands(experiment, readGlobals)

const experimentSection = experiment
  .command('section')
  .description('managed-section compatibility aliases')
experimentSection
  .command('show <id-or-slug> <section>')
  .description('show a managed Experiment section')
  .action(async (idOrSlug: string, section: string) => {
    await runExperimentDocumentShow({ ...readGlobals(), idOrSlug, section })
  })

experiment
  .command('link <id-or-slug> <run-dir-or-id>')
  .description("add a run's project-relative path to the experiment's runs (run README untouched)")
  .action(async (experimentIdOrSlug: string, runIdOrDir: string) => {
    const g = readGlobals()
    await runExperimentLink({ ...g, experimentIdOrSlug, runIdOrDir })
  })

experiment
  .command('unlink <id-or-slug> <run-dir-or-id>')
  .description("remove a run from the experiment's runs (run README untouched)")
  .action(async (experimentIdOrSlug: string, runIdOrDir: string) => {
    const g = readGlobals()
    await runExperimentUnlink({ ...g, experimentIdOrSlug, runIdOrDir })
  })

experiment
  .command('delete <id-or-slug>')
  .description(
    'delete an experiment doc, releasing its declared runs (requires --force when runs are declared)',
  )
  .option('--force', 'cascade-unlink without prompting', false)
  .action(async (experimentIdOrSlug: string, opts: { force?: boolean }) => {
    const g = readGlobals()
    await runExperimentDelete({
      ...g,
      experimentIdOrSlug,
      force: !!opts.force,
    })
  })

const status = experiment
  .command('status')
  .description(
    'status field operations. Run-id form (`<slug>-<YYMMDD>-<HHMMSS>`) is a deprecation alias for `memon run status`; exp-id form (`E<NNNN>-<slug>`) writes ExperimentStatus on the exp doc.',
  )
status
  .command('set <id>')
  .description(
    'atomically set status and record the invocation. Run: PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN. Experiment: OPEN|RESOLVED|ABANDONED.',
  )
  .requiredOption(
    '--to <status>',
    'run-side: PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN; exp-side: OPEN|RESOLVED|ABANDONED',
  )
  .requiredOption(
    '--expected-mtime <ms>',
    "expected README mtime (epoch ms; get from 'memon show')",
    (v) => Number(v),
  )
  .action(async (id: string, opts: { to: string; expectedMtime: number }) => {
    const g = readGlobals()
    if (EXPERIMENT_DIR_REGEX.test(id)) {
      // Exp-id form (v3+) — operate on the exp doc.
      await runExperimentStatusSet({
        ...g,
        experimentId: id,
        to: opts.to,
        expectedMtime: opts.expectedMtime,
      })
      return
    }
    // Run-id form — deprecation alias for `memon run status set`.
    if (RUN_DIR_REGEX.test(id)) {
      emitV2DeprecationBanner('experiment status set', 'run status set')
      await runStatusSet({ ...g, runId: id, to: opts.to, expectedMtime: opts.expectedMtime })
      return
    }
    emitErrorAndExit(
      'BAD_REQUEST',
      `id "${id}" matches neither EXPERIMENT_DIR_REGEX (E<NNNN>-<slug>) nor RUN_DIR_REGEX (<slug>-<YYMMDD>-<HHMMSS>)`,
    )
  })

const readme = experiment.command('readme').description('README.md operations')
readme
  .command('write <id>')
  .description('overwrite README.md (content from stdin) with mtime/hash lock')
  .requiredOption('--expected-mtime <ms>', 'expected README mtime', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 check')
  .action(async (id: string, opts: { expectedMtime: number; expectedHash?: string }) => {
    const g = readGlobals()
    const stdinContent = await readStdin()
    if (!stdinContent) {
      emitErrorAndExit(
        'BAD_REQUEST',
        'expected README content on stdin (e.g. cat new.md | memon experiment readme write ...)',
      )
    }
    emitV2DeprecationBanner('experiment readme write', 'run readme write')
    await runReadmeWrite({
      ...g,
      runId: id,
      expectedMtime: opts.expectedMtime,
      expectedHash: opts.expectedHash,
      stdinContent,
    })
  })

const warning = experiment.command('warning').description('Warnings table operations on README.md')
warning
  .command('add <id>')
  .description(
    'append a new OPEN warning row (id may be a v3 experiment doc id `E<NNNN>-<slug>` or a legacy run dir name)',
  )
  .requiredOption('--category <cat>', 'methodology|result|config|data|repro|compare|infra|other')
  .requiredOption('--message <text>', 'free-text description of the warning')
  .option(
    '--run <runDir>',
    'attribute the warning to a specific run (v3 exp doc form only; rejected with run-dir id)',
  )
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(
    async (
      id: string,
      opts: {
        category: string
        message: string
        run?: string
        expectedMtime?: number
        expectedHash?: string
      },
    ) => {
      emitWarningDeprecationBanner()
      const g = readGlobals()
      await runWarningAdd({
        ...g,
        runId: id,
        category: opts.category,
        message: opts.message,
        run: opts.run,
        expectedMtime: opts.expectedMtime,
        expectedHash: opts.expectedHash,
      })
    },
  )
warning
  .command('list <id>')
  .description('list warnings on a run')
  .option('--status <s>', 'open | resolved | all (default all)', 'all')
  .action(async (id: string, opts: { status?: string }) => {
    emitWarningDeprecationBanner()
    const g = readGlobals()
    const status = opts.status === 'open' ? 'open' : opts.status === 'resolved' ? 'resolved' : 'all'
    await runWarningList({ ...g, runId: id, status })
  })
warning
  .command('resolve <id> <rowId>')
  .description('mark a warning resolved with a required note')
  .requiredOption('--note <text>', 'how it was resolved (required)')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(
    async (
      id: string,
      rowId: string,
      opts: { note: string; expectedMtime?: number; expectedHash?: string },
    ) => {
      emitWarningDeprecationBanner()
      const g = readGlobals()
      await runWarningResolve({
        ...g,
        runId: id,
        rowId,
        note: opts.note,
        expectedMtime: opts.expectedMtime,
        expectedHash: opts.expectedHash,
      })
    },
  )
warning
  .command('reopen <id> <rowId>')
  .description('flip a RESOLVED warning back to OPEN')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(
    async (id: string, rowId: string, opts: { expectedMtime?: number; expectedHash?: string }) => {
      emitWarningDeprecationBanner()
      const g = readGlobals()
      await runWarningReopen({
        ...g,
        runId: id,
        rowId,
        expectedMtime: opts.expectedMtime,
        expectedHash: opts.expectedHash,
      })
    },
  )
warning
  .command('delete <id> <rowId>')
  .description('remove a warning row and record the invocation')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(
    async (id: string, rowId: string, opts: { expectedMtime?: number; expectedHash?: string }) => {
      emitWarningDeprecationBanner()
      const g = readGlobals()
      await runWarningDelete({
        ...g,
        runId: id,
        rowId,
        expectedMtime: opts.expectedMtime,
        expectedHash: opts.expectedHash,
      })
    },
  )

experiment
  .command('archive <id>')
  .description(
    'mark archived. Run-id (`<slug>-<YYMMDD>-<HHMMSS>`): deprecation alias for `memon run archive`. Exp-id (`E<NNNN>-<slug>`): writes archived: true on the exp doc.',
  )
  .action(async (id: string) => {
    const g = readGlobals()
    if (EXPERIMENT_DIR_REGEX.test(id)) {
      await runExperimentArchiveDoc({ ...g, experimentId: id })
      return
    }
    if (RUN_DIR_REGEX.test(id)) {
      emitV2DeprecationBanner('experiment archive', 'run archive')
      await runArchive({ ...g, runId: id })
      return
    }
    emitErrorAndExit('BAD_REQUEST', `id "${id}" matches neither exp nor run pattern`)
  })
experiment
  .command('unarchive <id>')
  .description(
    'unmark archived. Run-id: deprecation alias for `memon run unarchive`. Exp-id: writes archived: false on the exp doc.',
  )
  .action(async (id: string) => {
    const g = readGlobals()
    if (EXPERIMENT_DIR_REGEX.test(id)) {
      await runExperimentUnarchiveDoc({ ...g, experimentId: id })
      return
    }
    if (RUN_DIR_REGEX.test(id)) {
      emitV2DeprecationBanner('experiment unarchive', 'run unarchive')
      await runUnarchive({ ...g, runId: id })
      return
    }
    emitErrorAndExit('BAD_REQUEST', `id "${id}" matches neither exp nor run pattern`)
  })

/**
 * v3 task 7.7: emit a one-line deprecation banner to stderr when a legacy
 * v2-alias subcommand is invoked. Stays out of stdout so JSON consumers
 * don't see it. Suppressed when MEMON_QUIET_DEPRECATIONS is set so
 * scripted callers can opt out.
 */
function emitV2DeprecationBanner(legacy: string, replacement: string): void {
  if (process.env.MEMON_QUIET_DEPRECATIONS) return
  process.stderr.write(
    `[deprecation] \`memon ${legacy}\` is a v2 alias and will be removed in a future release; use \`memon ${replacement}\` instead.\n`,
  )
}

const run = program
  .command('run')
  .description('run-dir commands (v3 logs/<slug>-<YYMMDD>-<HHMMSS>/)')

registerRunResultCommands(run, readGlobals)

run
  .command('rename <id-or-dir> <new-slug>')
  .description(
    "rename a run's slug (timestamp suffix preserved); updates the declaring exp's runs path",
  )
  .action(async (runIdOrDir: string, newSlug: string) => {
    const g = readGlobals()
    await runRunRename({ ...g, runIdOrDir, newSlug })
  })

run
  .command('resolve-exp <id-or-dir>')
  .description(
    'print the parent exp doc id for a run; exit 1 (BAD_STATE) on orphan, exit 4 (NOT_FOUND) on unknown',
  )
  .action(async (runIdOrDir: string) => {
    const g = readGlobals()
    await runResolveExp({ ...g, runIdOrDir })
  })

const runWarning = run.command('warning').description('run-side warning operations')
runWarning
  .command('add <id-or-dir>')
  .description(
    "resolve the run's parent exp + dispatch to `experiment warning add <exp> --run <run>`; refuses orphan runs",
  )
  .requiredOption('--category <cat>', 'methodology|result|config|data|repro|compare|infra|other')
  .requiredOption('--message <text>', 'free-text description of the warning')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(
    async (
      runIdOrDir: string,
      opts: {
        category: string
        message: string
        expectedMtime?: number
        expectedHash?: string
      },
    ) => {
      emitWarningDeprecationBanner()
      const g = readGlobals()
      await runRunWarningAdd({
        ...g,
        runIdOrDir,
        category: opts.category,
        message: opts.message,
        expectedMtime: opts.expectedMtime,
        expectedHash: opts.expectedHash,
      })
    },
  )

run
  .command('record <id-or-dir>')
  .description(
    'write the minimal README for an execution directory that already exists (id or path). Records only: never launches, schedules, or creates a run directory. Emits id/status/created_at plus the execution facts you pass — no narrative placeholders, no Experiment metadata. Optional free-form body from stdin. Refuses to overwrite an existing README. Bind it afterwards with `experiment link`.',
  )
  .option('--status <status>', 'PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN', 'PENDING')
  .option('--name <text>', 'short human label for this run')
  .option(
    '--created-at <iso>',
    'ISO8601 with offset (default: the timestamp in the directory name)',
  )
  .option('--finished-at <iso>', 'ISO8601 with offset')
  .option('--host <name>', 'execution host')
  .option('--pid <n>', 'process id', (v) => Number(v))
  .option('--gpus <list>', 'comma-separated GPU indices')
  .option('--entry <path>', 'entry script')
  .option('--command <text>', 'command line as launched')
  .option('--wandb <url>', 'run URL in the tracking service')
  .option('--body', 'read a free-form body from stdin', false)
  .action(
    async (
      idOrDir: string,
      opts: {
        status?: string
        name?: string
        createdAt?: string
        finishedAt?: string
        host?: string
        pid?: number
        gpus?: string
        entry?: string
        command?: string
        wandb?: string
        body?: boolean
      },
    ) => {
      const g = readGlobals()
      const body = opts.body ? await readStdin() : undefined
      await runRunRecord({ ...g, ...opts, target: idOrDir, body })
    },
  )
run
  .command('archive <id>')
  .description('mark a run as archived (writes archived: true to README frontmatter)')
  .action(async (id: string) => {
    const g = readGlobals()
    await runArchive({ ...g, runId: id })
  })
run
  .command('unarchive <id>')
  .description('unmark archived')
  .action(async (id: string) => {
    const g = readGlobals()
    await runUnarchive({ ...g, runId: id })
  })
run
  .command('lint <id-or-dir>')
  .description(
    'structural lint of one run: README frontmatter schema, id/directory agreement, timestamp and reference formats. Reads only; never journaled.',
  )
  .action(async (id: string) => {
    const g = readGlobals()
    await runRunLint({ ...g, runId: id })
  })
run
  .command('deprecate <id-or-dir>')
  .description(
    'mark a run deprecated (writes deprecated: true to README frontmatter). Orthogonal to status and archival: no signal, no artifact deletion, RUNNING runs may be deprecated. Idempotent.',
  )
  .option(
    '--expected-mtime <ms>',
    "optional README mtime lock (get from 'memon show'); omit for an unconditional write",
    (v) => Number(v),
  )
  .action(async (id: string, opts: { expectedMtime?: number }) => {
    const g = readGlobals()
    await runRunDeprecate({ ...g, runId: id, expectedMtime: opts.expectedMtime })
  })
run
  .command('undeprecate <id-or-dir>')
  .description('clear the deprecated marker on a run. Idempotent.')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .action(async (id: string, opts: { expectedMtime?: number }) => {
    const g = readGlobals()
    await runRunUndeprecate({ ...g, runId: id, expectedMtime: opts.expectedMtime })
  })

const runStatus = run.command('status').description('run status field operations')
runStatus
  .command('set <id>')
  .description('atomically write README + append [STATUS] event')
  .requiredOption('--to <status>', 'PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN')
  .requiredOption('--expected-mtime <ms>', 'expected README mtime', (v) => Number(v))
  .action(async (id: string, opts: { to: string; expectedMtime: number }) => {
    const g = readGlobals()
    await runStatusSet({ ...g, runId: id, to: opts.to, expectedMtime: opts.expectedMtime })
  })

const runReadme = run.command('readme').description('run README.md operations')
runReadme
  .command('write <id>')
  .description('overwrite README.md (content from stdin) with mtime/hash lock')
  .requiredOption('--expected-mtime <ms>', 'expected README mtime', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 check')
  .action(async (id: string, opts: { expectedMtime: number; expectedHash?: string }) => {
    const g = readGlobals()
    const stdinContent = await readStdin()
    if (!stdinContent) {
      emitErrorAndExit(
        'BAD_REQUEST',
        'expected README content on stdin (e.g. cat new.md | memon run readme write ...)',
      )
    }
    await runReadmeWrite({
      ...g,
      runId: id,
      expectedMtime: opts.expectedMtime,
      expectedHash: opts.expectedHash,
      stdinContent,
    })
  })

program
  .command('install-skills')
  .description(
    'sync bundled memon-* skills into per-agent skills dirs under <projectRoot> (replaces all memon-* there)',
  )
  .option(
    '--agent <list>',
    'comma-separated subset of claude,codex,opencode (or "all"); default: all three',
  )
  .option('--target <path>', 'override the target directory (mutually exclusive with --agent)')
  .option('--dry-run', "don't copy, just report what would be done", false)
  .action(async (opts: { target?: string; agent?: string; dryRun?: boolean }) => {
    const g = readGlobals()
    if (opts.target && opts.agent !== undefined) {
      emitErrorAndExit('BAD_REQUEST', '--target and --agent cannot both be set')
    }
    const agents = opts.agent !== undefined ? parseAgentList(opts.agent) : undefined
    await runInstallSkills({
      projectRoot: g.projectRoot,
      target: opts.target,
      agents,
      cwd: g.cwd,
      dryRun: !!opts.dryRun,
      format: g.format,
    })
  })

const share = program
  .command('share')
  .description('per-project share-link commands (writes <projectRoot>/.memon/shares.json)')
share
  .command('create <project>')
  .description('issue a new share link for the project; prints the URL')
  .option('--label <text>', 'human-readable label (≤ 64 chars)')
  .option('--expires <duration>', '"never" | "<int>d" | "<int>h" (default never)')
  .option(
    '--url-base <base>',
    'origin to prepend to the share path (e.g. https://memon.example.com); falls back to $MEMON_PUBLIC_URL, else path-only output',
  )
  .action(
    async (projectName: string, opts: { label?: string; expires?: string; urlBase?: string }) => {
      const g = readGlobals()
      await runShareCreate({
        ...g,
        projectName,
        label: opts.label,
        expires: opts.expires,
        urlBase: opts.urlBase,
      })
    },
  )
share
  .command('list')
  .description('list share records for the project (tokens redacted)')
  .option('--project <name>', 'project name to display (default: derived from --project-root)')
  .action(async (opts: { project?: string }) => {
    const g = readGlobals()
    await runShareList({ ...g, projectName: opts.project })
  })
share
  .command('revoke <id-or-label>')
  .description('remove a share by id-prefix or exact label')
  .option('--force', 'revoke ALL matching records on ambiguity', false)
  .action(async (idOrLabel: string, opts: { force?: boolean }) => {
    const g = readGlobals()
    await runShareRevoke({ ...g, idOrLabel, force: !!opts.force })
  })

const fsVersion = program
  .command('fs-version')
  .description('FS convention version commands (per-project marker .memon/version.json)')
fsVersion
  .command('check')
  .description("report a project root's FS convention version vs the bundled tool version")
  .action(async () => {
    const g = readGlobals()
    await runFsVersionCheck({ projectRoot: g.projectRoot, cwd: g.cwd, format: g.format })
  })

// ---------- memon index (FS v8 derived index) ----------

const indexCommand = program
  .command('index')
  .description(
    'maintain and inspect the derived index .memon/index/ (a rebuildable cache, never edited by hand; writes keep it current automatically)',
  )
indexCommand
  .command('status')
  .description(
    'report the index: snapshot, recorded vs effective run_dirs, entry counts, unmerged events, lease',
  )
  .option('--verify', 're-take every fingerprint and re-walk; list INDEX_DRIFT records', false)
  .option('--strict', 'with --verify: exit 1 when any drift is found', false)
  .action(async (opts: { verify?: boolean; strict?: boolean }) => {
    const g = readGlobals()
    await runIndexStatus({ ...g, verify: !!opts.verify, strict: !!opts.strict })
  })
indexCommand
  .command('compact')
  .description('merge unmerged events into the snapshot (no document reads; exit 9 while leased)')
  .action(async () => {
    await runIndexCompact(readGlobals())
  })
indexCommand
  .command('rebuild')
  .description('rebuild the index from the project files alone (exit 9 while leased)')
  .option(
    '--audit-run-dirs',
    'also list Run directories under logs/, outputs/, experiments/ that the effective run_dirs miss',
    false,
  )
  .option('--dry-run', 'compute and report without writing any file', false)
  .action(async (opts: { auditRunDirs?: boolean; dryRun?: boolean }) => {
    const g = readGlobals()
    await runIndexRebuild({ ...g, auditRunDirs: !!opts.auditRunDirs, dryRun: !!opts.dryRun })
  })

// ---------- memon project (tracked .memon/project.yml) ----------

const projectCommand = program
  .command('project')
  .description(
    'the tracked project declaration .memon/project.yml (project layout: run_dirs, include, exclude, github)',
  )
interface ProjectCentralOptions {
  fromCentral?: string
  project?: string
  host?: string
}
const withCentralOptions = (command: Command): Command =>
  command
    .option(
      '--from-central <config>',
      'read the layout keys of a Project entry in this central config.yml (with --project)',
    )
    .option('--project <name>', 'Project name in the --from-central configuration')
    .option('--host <id>', 'Host namespace, when the Project name is ambiguous')
withCentralOptions(
  projectCommand
    .command('init')
    .description(
      'create .memon/project.yml with the default run_dirs (or the global --run-dir patterns, or the layout of a central Project with --from-central); never overwrites, never commits',
    ),
).action(async (opts: ProjectCentralOptions) => {
  await runProjectInit({
    ...readGlobals(),
    fromCentral: opts.fromCentral,
    centralProject: opts.project,
    centralHost: opts.host,
  })
})
withCentralOptions(
  projectCommand
    .command('lint')
    .description(
      'validate .memon/project.yml and print the effective layout with each source; with --from-central also report CENTRAL_LAYOUT_DEPRECATED keys',
    ),
).action(async (opts: ProjectCentralOptions) => {
  await runProjectLint({
    ...readGlobals(),
    fromCentral: opts.fromCentral,
    centralProject: opts.project,
    centralHost: opts.host,
  })
})

// ---------- memon components ----------

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

// ---------- memon wiki ----------

const wiki = program
  .command('wiki')
  .description('wiki commands (docs/wiki/<kind>/W<NNNN>-<slug>{.md,/README.md})')

const wikiKinds = wiki.command('kinds').description('list or explain shipped Wiki kinds')
wikiCommand(wikiKinds, 'ls', 'list all supported Wiki kinds').action(async (opts) => {
  const { runWikiKinds } = await import('./commands/wiki.js')
  await runWikiKinds(wikiGlobals(opts))
})
wikiCommand(wikiKinds, 'show <kind>', 'explain a Wiki kind and its authoring rules').action(
  async (kind, opts) => {
    const { runWikiKinds } = await import('./commands/wiki.js')
    await runWikiKinds({ ...wikiGlobals(opts), kind })
  },
)

interface WikiLocalOptions {
  projectRoot?: string
  format?: string
}

/**
 * Wiki subcommands take `--project-root` / `--format` after the subcommand as
 * well as before it (`memon --format human wiki ls`) — both forms appear in
 * the `memon-wiki` skill, and a rejected flag there is an agent dead end.
 * `--format` is passed through raw; `wiki.ts` validates it (markdown is only
 * legal on `ls` / `show`).
 */
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

/** Repeatable option collector (`--source E0002 --source E0003`). */
function collectOption(value: string, previous: string[]): string[] {
  return [...previous, value]
}

wikiCommand(wiki, 'ls', 'list wiki pages with optional filters', true)
  .option('--kind <kind>', 'restrict to one kind directory')
  .option('--status <status>', 'restrict to one status')
  .option('--tag <tag>', 'restrict to pages carrying this tag')
  .option('--source <artifact>', 'only pages declaring this source token')
  .option('--deprecated', 'only deprecated pages')
  .option('--no-deprecated', 'hide deprecated pages')
  .option('--no-description', 'suppress the description line (human / markdown)')
  .action(
    async (
      opts: WikiLocalOptions & {
        kind?: string
        status?: string
        tag?: string
        source?: string
        deprecated?: boolean
        description?: boolean
      },
    ) => {
      await runWikiLs({ ...wikiGlobals(opts), ...opts })
    },
  )

wikiCommand(wiki, 'show <page>', 'print one page (slug or W<NNNN>) with its diagnostics', true)
  .option('--body-only', 'print only the Markdown body after the frontmatter', false)
  .action(async (page: string, opts: WikiLocalOptions & { bodyOnly?: boolean }) => {
    await runWikiShow({ ...wikiGlobals(opts), page, bodyOnly: opts.bodyOnly })
  })

wikiCommand(wiki, 'create <kind> <slug>', 'allocate the next W<NNNN> and write a page template')
  .requiredOption('--title <text>', 'page title (also the H1)')
  .option('--description <text>', 'one to three sentences that stand alone in a listing')
  .option('--status <status>', "status from the kind's vocabulary (default: its first value)")
  .option('--date <YYYY-MM-DD>', 'meeting date (required for `meeting`)')
  .option(
    '--source <artifact>',
    'cite an Experiment / Variant / Hypothesis / run (repeatable)',
    collectOption,
    [],
  )
  .option('--tag <tag>', 'add a tag (repeatable)', collectOption, [])
  .option('--language <en|zh>', 'content language of the page (default: en)')
  .option('--bundle', 'create the bundle form (<slug>/README.md + assets)', false)
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

wikiCommand(wiki, 'set <page>', 'edit frontmatter only, with an optional mtime lock')
  .option('--status <status>', 'new status')
  .option('--title <text>', 'new title')
  .option('--description <text>', 'new description')
  .option('--date <YYYY-MM-DD>', 'new meeting date')
  .option('--language <en|zh>', 'content language of the page')
  .option('--add-source <artifact>', 'append to `sources` (repeatable)', collectOption, [])
  .option('--rm-source <artifact>', 'remove from `sources` (repeatable)', collectOption, [])
  .option('--add-tag <tag>', 'append to `tags` (repeatable)', collectOption, [])
  .option('--rm-tag <tag>', 'remove from `tags` (repeatable)', collectOption, [])
  .option('--expected-mtime <ms>', 'refuse the write unless the page mtime matches', (v) =>
    Number(v),
  )
  .action(
    async (
      page: string,
      opts: WikiLocalOptions & {
        status?: string
        title?: string
        description?: string
        date?: string
        language?: string
        addSource?: string[]
        rmSource?: string[]
        addTag?: string[]
        rmTag?: string[]
        expectedMtime?: number
      },
    ) => {
      await runWikiSet({ ...wikiGlobals(opts), ...opts, page })
    },
  )

wikiCommand(wiki, 'lint [page]', 'report diagnostics for one page or the whole wiki')
  .option('--strict', 'exit 1 when any `error` severity diagnostic exists', false)
  .action(async (page: string | undefined, opts: WikiLocalOptions & { strict?: boolean }) => {
    await runWikiLint({ ...wikiGlobals(opts), page, strict: opts.strict })
  })

wikiCommand(wiki, 'backlinks <artifact>', 'list pages declaring an artifact source').action(
  async (artifact: string, opts: WikiLocalOptions) => {
    await runWikiBacklinks({ ...wikiGlobals(opts), artifact })
  },
)

wikiCommand(
  wiki,
  'migrate-report <report> <kind> [slug]',
  'move one docs/reports/R<NNNN> into the wiki',
)
  .option('--status <status>', "status from the target kind's vocabulary")
  .action(
    async (
      report: string,
      kind: string,
      slug: string | undefined,
      opts: WikiLocalOptions & { status?: string },
    ) => {
      await runWikiMigrateReport({ ...wikiGlobals(opts), report, kind, slug, status: opts.status })
    },
  )

wikiCommand(wiki, 'deprecate <page>', 'mark a page outdated without deleting it')
  .requiredOption('--reason <text>', 'why the page is deprecated')
  .option('--superseded-by <W-id>', 'the page that replaces this one')
  .option('--at <iso>', 'deprecation timestamp (default: now with offset)')
  .action(
    async (
      page: string,
      opts: WikiLocalOptions & { reason: string; supersededBy?: string; at?: string },
    ) => {
      await runWikiDeprecate({ ...wikiGlobals(opts), ...opts, page })
    },
  )

wikiCommand(wiki, 'undeprecate <page>', 'remove a page-level deprecation').action(
  async (page: string, opts: WikiLocalOptions) => {
    await runWikiUndeprecate({ ...wikiGlobals(opts), page })
  },
)

wikiCommand(wiki, 'delete <page>', 'delete a page (bundles with assets require --force)')
  .option('--force', 'delete a bundle that holds more than README.md', false)
  .action(async (page: string, opts: WikiLocalOptions & { force?: boolean }) => {
    await runWikiDelete({ ...wikiGlobals(opts), page, force: opts.force })
  })

wikiCommand(
  wiki,
  'commit [pages...]',
  'commit wiki changes (all, or only the named pages) as `wiki: <summary>` and push',
)
  .option('-m, --message <summary>', 'commit summary (default: generated from the touched pages)')
  .option(
    '--allow-empty-message',
    'accept an empty -m and fall back to the generated summary',
    false,
  )
  .option('--no-push', 'keep the commit local instead of pushing it to the upstream branch')
  .action(
    async (
      pages: string[],
      opts: WikiLocalOptions & {
        message?: string
        allowEmptyMessage?: boolean
        push?: boolean
      },
    ) => {
      await runWikiCommit({ ...wikiGlobals(opts), ...opts, pages, noPush: opts.push === false })
    },
  )

const wikiReview = wiki
  .command('review')
  .description('commit-ordered human verification of docs/wiki/ (.memon/wiki-review.csv)')

wikiCommand(wikiReview, 'log', 'every wiki commit in order with its verification state').action(
  async (opts: WikiLocalOptions) => {
    await runWikiReviewLog(wikiGlobals(opts))
  },
)

wikiCommand(
  wikiReview,
  'diff',
  'one whole-wiki diff from the verified commit to HEAD (committed changes only)',
).action(async (opts: WikiLocalOptions) => {
  await runWikiReviewDiff(wikiGlobals(opts))
})

wikiCommand(
  wikiReview,
  'verify <sha>',
  'mark a wiki commit verified (human only; `next` = oldest unmarked)',
)
  .option('--note <text>', 'note stored with the mark')
  .action(async (sha: string, opts: WikiLocalOptions & { note?: string }) => {
    await runWikiReviewVerify({ ...wikiGlobals(opts), sha, note: opts.note })
  })

wikiCommand(wikiReview, 'unverify <sha>', 'remove a mark and every newer one (human only)').action(
  async (sha: string, opts: WikiLocalOptions) => {
    await runWikiReviewUnverify({ ...wikiGlobals(opts), sha })
  },
)

function interceptParserExits(command: Command): void {
  command.exitOverride()
  command.hook('preSubcommand', (_parent, child) => {
    parsingCommand = child
  })
  for (const child of command.commands) interceptParserExits(child)
}

interceptParserExits(program)

async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.exitCode !== 0 && parsingCommand.commands.length === 0) {
        if (!actionStarted) {
          await beginCliInvocation({
            command: parsingCommand,
            globalProjectRoot: program.opts<{ projectRoot?: string }>().projectRoot,
            cwd: process.cwd(),
            parserFailure: true,
          })
        }
        recordCliInvocationFailureSync('BAD_REQUEST')
      }
      process.exit(commanderExitCode(err.exitCode))
    }
    if (err instanceof ProjectDeclarationError) {
      // An invalid declaration fails closed: never silently use the default.
      emitErrorAndExit('BAD_REQUEST', err.message, {
        code: err.code,
        file: err.file,
        ...(err.key === undefined ? {} : { field: err.key }),
      })
    }
    if (err instanceof ConfigError) {
      process.stderr.write(`${JSON.stringify({ error: { message: err.message } })}\n`)
      process.exit(EXIT.GENERIC)
    }
    emitGenericAndExit(err)
  }
}

void main()
