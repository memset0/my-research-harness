#!/usr/bin/env node
// @memon/cli — `memon` command-line tool entry point.

import { Command } from 'commander'
import { ConfigError } from '@memon/core'
import { runList } from './commands/list.js'
import { runShow } from './commands/show.js'
import { runSearch } from './commands/search.js'
import { runHypoList, runHypoShow } from './commands/hypo.js'
import { runMockSeed } from './commands/mock.js'
import { runServe } from './commands/serve.js'
import { runScan } from './commands/scan.js'
import {
  runJournalAppend,
  runJournalDigestMark,
  runJournalRead,
} from './commands/journal.js'
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
import { EXPERIMENT_FILENAME_REGEX, RUN_DIR_REGEX } from '@memon/core'
import { runRunRename } from './commands/run-rename.js'
import { runResolveExp } from './commands/run-resolve-exp.js'
import { runRunWarningAdd } from './commands/run-warning.js'
import {
  runWarningAdd,
  runWarningDelete,
  runWarningList,
  runWarningReopen,
  runWarningResolve,
} from './commands/warning.js'
import { runHypothesesRead } from './commands/hypotheses.js'
import { runDoctorCmd } from './commands/doctor.js'
import { parseAgentList, runInstallSkills } from './commands/install-skills.js'
import { runFsVersionCheck } from './commands/fs-version-check.js'
import { runShareCreate, runShareList, runShareRevoke } from './commands/share.js'
import { emitErrorAndExit, emitGenericAndExit } from './lib/emit-error.js'
import { EXIT } from './lib/exit-codes.js'

const program = new Command()
program
  .name('memon')
  .description('experiment monitoring and management')
  .version('0.0.0')
  .option('--project-root <path>', 'use <path> as the only project (default: cwd)')
  .option('--format <fmt>', 'output format: json | human', 'json')

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

// ---------- read commands (existing) ----------

program
  .command('list')
  .description('list experiments across configured projects')
  .option('--project <name>', 'restrict to a single project')
  .action(async (opts: { project?: string }) => {
    const g = readGlobals()
    if (g.projectRoot && opts.project) {
      emitErrorAndExit('BAD_REQUEST', '--project-root cannot be combined with --project')
    }
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
  .option('--config <path>', 'path to config.yml (default: <cwd>/config.yml or <repo-root>/config.yml)')
  .option('--dev', 'run Next.js in dev mode', false)
  .option('-p, --port <port>', 'port to bind (default 3737)', '3737')
  .action(async (opts: { config?: string; dev?: boolean; port?: string }) => {
    const g = readGlobals()
    if (g.projectRoot) {
      emitErrorAndExit(
        'BAD_REQUEST',
        '--project-root is not supported by `memon serve`; use config.yml',
      )
    }
    await runServe({
      configPath: opts.config,
      cwd: g.cwd,
      dev: !!opts.dev,
      port: Number(opts.port) || 3737,
    })
  })

// ---------- new agent-shaped read commands ----------

program
  .command('scan [project-root]')
  .description('bulk-read a project root: experiments + hypotheses + journal')
  .option('--include-archived', 'include archived runs in the result', false)
  .option('--archived-only', 'return ONLY archived runs', false)
  .action(async (positionalRoot: string | undefined, opts: { includeArchived?: boolean; archivedOnly?: boolean }) => {
    const g = readGlobals()
    if (opts.includeArchived && opts.archivedOnly) {
      emitErrorAndExit('BAD_REQUEST', '--include-archived and --archived-only are mutually exclusive')
    }
    const root = positionalRoot ?? g.projectRoot ?? g.cwd
    await runScan({
      projectRoot: root,
      includeArchived: !!opts.includeArchived,
      archivedOnly: !!opts.archivedOnly,
      format: g.format,
    })
  })

const journal = program.command('journal').description('docs/journal.md commands')
journal
  .command('read')
  .description('read parsed events from docs/journal.md (JSON)')
  .option('--since <iso>', 'filter events with timestamp >= this ISO string')
  .option('--tag <tag>', 'filter by tag (NOTE / REQUEST / STATUS / CREATE / ARCHIVE / ERROR)')
  .option('--experiment-id <id>', 'filter to events touching this experiment id')
  .option('--limit <n>', 'cap returned events (default 200, max 1000)', (v) => parseInt(v, 10), 200)
  .action(async (opts: { since?: string; tag?: string; runId?: string; limit?: number }) => {
    const g = readGlobals()
    await runJournalRead({ ...g, ...opts })
  })
journal
  .command('append')
  .description('append a single [NOTE]/[REQUEST]/[ERROR]/[ARCHIVE]/[CREATE] event (no STATUS)')
  .requiredOption('--tag <tag>', 'event tag')
  .requiredOption('--body <body>', 'event body text')
  .option('--experiment-id <id>', 'optional id to prefix in the body')
  .option('--at <iso>', 'override the event timestamp (default: now)')
  .action(async (opts: { tag: string; body: string; runId?: string; at?: string }) => {
    const g = readGlobals()
    await runJournalAppend({ ...g, ...opts })
  })
journal
  .command('digest-mark')
  .description('update last_digest_at in docs/journal.md frontmatter (digest skill only)')
  .requiredOption('--at <iso>', 'ISO8601 timestamp with offset')
  .action(async (opts: { at: string }) => {
    const g = readGlobals()
    await runJournalDigestMark({ ...g, at: opts.at })
  })

program
  .command('hypotheses')
  .description('hypotheses commands (agent-shaped JSON output)')
  .addCommand(
    new Command('read')
      .description('read parsed docs/hypotheses.md (JSON)')
      .action(async () => {
        const g = readGlobals()
        await runHypothesesRead(g)
      }),
  )

const experiment = program
  .command('experiment')
  .description('experiment-doc commands (v3 docs/experiments/E<NNNN>-<slug>.md)')

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
  .description('allocate next E<NNNN> and write docs/experiments/E<NNNN>-<slug>.md')
  .option('--title <text>', 'human-readable title')
  .option('--hypotheses <list>', 'comma-separated H<NNNN> ids')
  .option('--from-run <run-dir>', 'bind an existing run as the first member')
  .action(
    async (
      slug: string,
      opts: { title?: string; hypotheses?: string; fromRun?: string },
    ) => {
      const g = readGlobals()
      const hyps = opts.hypotheses
        ? opts.hypotheses.split(',').map((s) => s.trim()).filter(Boolean)
        : []
      await runExperimentCreate({
        ...g,
        slug,
        title: opts.title,
        hypotheses: hyps,
        fromRun: opts.fromRun,
      })
    },
  )

experiment
  .command('link <id-or-slug> <run-dir-or-id>')
  .description('bidirectionally bind a run to an experiment')
  .action(async (experimentIdOrSlug: string, runIdOrDir: string) => {
    const g = readGlobals()
    await runExperimentLink({ ...g, experimentIdOrSlug, runIdOrDir })
  })

experiment
  .command('unlink <id-or-slug> <run-dir-or-id>')
  .description('clear the binding on both sides')
  .action(async (experimentIdOrSlug: string, runIdOrDir: string) => {
    const g = readGlobals()
    await runExperimentUnlink({ ...g, experimentIdOrSlug, runIdOrDir })
  })

experiment
  .command('delete <id-or-slug>')
  .description("delete an experiment doc; cascade-unlinks runs (requires --force when bound runs exist)")
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
    'atomically set status. Run-id: writes [STATUS] event with values PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN. Exp-id: writes [EXP_STATUS] with OPEN|RESOLVED|ABANDONED.',
  )
  .requiredOption('--to <status>', 'run-side: PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN; exp-side: OPEN|RESOLVED|ABANDONED')
  .requiredOption(
    '--expected-mtime <ms>',
    "expected README mtime (epoch ms; get from 'memon show')",
    (v) => Number(v),
  )
  .action(async (id: string, opts: { to: string; expectedMtime: number }) => {
    const g = readGlobals()
    if (`${id}.md`.match(EXPERIMENT_FILENAME_REGEX)) {
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
      `id "${id}" matches neither EXPERIMENT_FILENAME_REGEX (E<NNNN>-<slug>) nor RUN_DIR_REGEX (<slug>-<YYMMDD>-<HHMMSS>)`,
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
      emitErrorAndExit('BAD_REQUEST', 'expected README content on stdin (e.g. cat new.md | memon experiment readme write ...)')
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
  .action(async (id: string, rowId: string, opts: { expectedMtime?: number; expectedHash?: string }) => {
    const g = readGlobals()
    await runWarningReopen({
      ...g,
      runId: id,
      rowId,
      expectedMtime: opts.expectedMtime,
      expectedHash: opts.expectedHash,
    })
  })
warning
  .command('delete <id> <rowId>')
  .description('remove a warning row (audit kept in JOURNAL)')
  .option('--expected-mtime <ms>', 'optional README mtime lock', (v) => Number(v))
  .option('--expected-hash <sha1>', 'optional content sha1 lock')
  .action(async (id: string, rowId: string, opts: { expectedMtime?: number; expectedHash?: string }) => {
    const g = readGlobals()
    await runWarningDelete({
      ...g,
      runId: id,
      rowId,
      expectedMtime: opts.expectedMtime,
      expectedHash: opts.expectedHash,
    })
  })

experiment
  .command('archive <id>')
  .description(
    'mark archived. Run-id (`<slug>-<YYMMDD>-<HHMMSS>`): deprecation alias for `memon run archive`. Exp-id (`E<NNNN>-<slug>`): writes archived: true on the exp doc.',
  )
  .action(async (id: string) => {
    const g = readGlobals()
    if (`${id}.md`.match(EXPERIMENT_FILENAME_REGEX)) {
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
    if (`${id}.md`.match(EXPERIMENT_FILENAME_REGEX)) {
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

run
  .command('rename <id-or-dir> <new-slug>')
  .description("rename a run's slug (timestamp suffix preserved); updates parent exp's runs[]")
  .action(async (runIdOrDir: string, newSlug: string) => {
    const g = readGlobals()
    await runRunRename({ ...g, runIdOrDir, newSlug })
  })

run
  .command('resolve-exp <id-or-dir>')
  .description(
    "print the parent exp doc id for a run; exit 1 (BAD_STATE) on orphan, exit 4 (NOT_FOUND) on unknown",
  )
  .action(async (runIdOrDir: string) => {
    const g = readGlobals()
    await runResolveExp({ ...g, runIdOrDir })
  })

const runWarning = run.command('warning').description('run-side warning operations')
runWarning
  .command('add <id-or-dir>')
  .description(
    'resolve the run\'s parent exp + dispatch to `experiment warning add <exp> --run <run>`; refuses orphan runs',
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
  .command('doctor')
  .description('scan a project root for issues (FINISHED w/ no Result, stale RUNNING, etc.)')
  .option('--include-archived', 'include archived runs', false)
  .option('--severity <level>', 'min severity to report: info | warn | error', 'info')
  .action(async (opts: { includeArchived?: boolean; severity?: string }) => {
    const g = readGlobals()
    const sev = opts.severity === 'warn' ? 'warn' : opts.severity === 'error' ? 'error' : 'info'
    await runDoctorCmd({
      ...g,
      includeArchived: !!opts.includeArchived,
      severity: sev as 'info' | 'warn' | 'error',
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
    async (
      projectName: string,
      opts: { label?: string; expires?: string; urlBase?: string },
    ) => {
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

async function main() {
  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`${JSON.stringify({ error: { message: err.message } })}\n`)
      process.exit(EXIT.GENERIC)
    }
    emitGenericAndExit(err)
  }
}

void main()
