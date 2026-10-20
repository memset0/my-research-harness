import { EXPERIMENT_DIR_REGEX, RUN_DIR_REGEX } from '@memon/core'
import { readStdin, runArchive, runUnarchive } from './commands/experiment.js'
import {
  runExperimentArchiveDoc,
  runExperimentLink,
  runExperimentUnarchiveDoc,
  runExperimentUnlink,
} from './commands/experiment-doc.js'
import { registerExperimentResearchCommands } from './commands/experiment-research.js'
import { registerLegacySchemaCommand } from './commands/results-commands.js'
import { runRunRecord } from './commands/run-record.js'
import { runRunRename } from './commands/run-rename.js'
import { emitErrorAndExit } from './lib/emit-error.js'
import { createProgram, readGlobalsFor } from './lib/program.js'

export function createLegacyProgram() {
  const program = createProgram('memon-legacy')
  const readGlobals = () => readGlobalsFor(program)

  const experiment = program
    .command('experiment')
    .description('create and read Experiments and their results')

  registerExperimentResearchCommands(experiment, readGlobals)
  registerLegacySchemaCommand(experiment, readGlobals)

  experiment
    .command('link <id-or-slug> <run-dir-or-id>')
    .description(
      "add a run's project-relative path to the experiment's runs (run README untouched)",
    )
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
    .command('archive <id>')
    .description(
      'archive an Experiment: FS10 sets lifecycle ARCHIVED, FS9 retains the archive flag. Run-id form aliases memon-legacy run archive.',
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
      'unarchive an Experiment: FS10 sets lifecycle ACTIVE, FS9 clears the archive flag. Run-id form aliases memon-legacy run unarchive.',
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

  function emitV2DeprecationBanner(legacy: string, replacement: string): void {
    if (process.env.MEMON_QUIET_DEPRECATIONS) return
    process.stderr.write(
      `[deprecation] \`memon ${legacy}\` is a v2 alias and will be removed in a future release; use \`memon ${replacement}\` instead.\n`,
    )
  }

  const run = program.command('run').description('Run execution metadata and results')

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
    .command('record <id-or-dir>')
    .option(
      '--experiment <id-or-slug>',
      'register a new execution in this Experiment before publishing membership',
    )
    .description(
      'record an existing execution directory: run.json in the lightweight layout, legacy README elsewhere. Never launches or overwrites.',
    )
    .option('--status <status>', 'PENDING|RUNNING|FINISHED|INTERRUPTED|FAILED|UNKNOWN', 'PENDING')
    .option('--name <text>', 'short human label for this run')
    .option(
      '--created-at <iso>',
      'ISO8601 with offset (lightweight default: now; legacy default: directory timestamp)',
    )
    .option('--finished-at <iso>', 'ISO8601 with offset')
    .option('--started-at <iso>', 'observed start time with numeric timezone offset')
    .option('--job-id <id>', 'scheduler job identity (lightweight Runs)')
    .option('--scheduler <name>', 'scheduler name with --job-id (lightweight Runs)')
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
          experiment?: string
          name?: string
          createdAt?: string
          finishedAt?: string
          startedAt?: string
          jobId?: string
          scheduler?: string
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
    .description('mark a Run archived in its execution record')
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
  return program
}
