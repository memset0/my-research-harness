import { runExperimentCreate } from './commands/experiment-doc.js'
import { parseAgentList, runInstallSkills } from './commands/install-skills.js'
import { registerRefreshCommand } from './commands/refresh.js'
import { type RunMetadataOptions, runRunCreate, runRunUpdate } from './commands/run-metadata.js'
import { registerShowCommand } from './commands/show.js'
import { registerLegacyCommands } from './legacy-program.js'
import { emitErrorAndExit } from './lib/emit-error.js'
import { createProgram, readGlobalsFor } from './lib/program.js'
import { registerToolsCommands } from './tools-program.js'

export function createResearchProgram() {
  const program = createProgram()
  const readGlobals = () => readGlobalsFor(program)
  registerShowCommand(program, readGlobals)
  const experiment = program.command('experiment').description('create and maintain Experiments')

  experiment
    .command('create <slug>')
    .description(
      'create an Experiment (FS11: README.md + experiment.json; existing legacy projects retain their format)',
    )
    .option('--title <text>', 'human-readable title')
    .option('--hypotheses <list>', 'comma-separated H<NNNN> ids')
    .option(
      '--from-run <run-dir>',
      'declare an existing run (project-relative path or unique id) as the first member',
    )
    .action(
      async (slug: string, opts: { title?: string; hypotheses?: string; fromRun?: string }) => {
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
      },
    )

  const run = program.command('run').description('Run execution metadata and results')

  const createRunCommand = run
    .command('create [id]')
    .description(
      'create a lightweight Run directory and tracked run.json; never launches a process',
    )
    .requiredOption('--experiment <id>', 'owning Experiment')
    .option('--variant <id>', 'existing/explicit V ID, or smoke (default: allocate next V ID)')
    .option(
      '--activate',
      'replace the Variant selection with this Run; the first Run is selected automatically',
    )

  const updateRunCommand = run
    .command('update <id-or-path>')
    .description('record Run state and publish results/index; direct file edits are also supported')
    .option('--activate', 'make this Run active and deactivate its peers')
    .option('--expected-mtime <ms>', 'optional metadata mtime lock', Number)
    .option('--expected-hash <hash>', 'optional metadata content hash lock')

  for (const command of [createRunCommand, updateRunCommand]) {
    command
      .option(
        '--status <status>',
        'READY|QUEUED|RUNNING|FINISHED|INTERRUPTED|FAILED|RESUME_READY|UNKNOWN (PENDING: legacy ambiguous)',
      )
      .option('--name <text>', 'optional display label')
      .option('--active <boolean>', 'true or false, independent of execution status')
      .option('--params <json>', 'partial or resolved parameters as a JSON object')
      .option('--description <text>', 'optional explanation')
      .option('--assessment <kind>', 'INVALID|LIMITED|SUPERSEDED|OTHER|clear')
      .option('--reason <text>', 'reason for the assessment')
      .option(
        '--created-at <iso>',
        'explicit historical creation time with numeric timezone offset',
      )
      .option('--started-at <iso>', 'observed start time with numeric timezone offset')
      .option('--finished-at <iso>', 'observed finish time with numeric timezone offset')
      .option('--host <name>', 'execution host')
      .option('--pid <n>', 'process id', Number)
      .option('--gpus <list>', 'comma-separated GPU indices')
      .option('--entry <path>', 'entry script')
      .option('--command <text>', 'command line as launched')
      .option('--wandb <url>', 'tracking URL')
      .option('--job-id <id>', 'scheduler job identity')
      .option('--scheduler <name>', 'scheduler name, with --job-id')
    const routineOptions = new Set([
      'experiment',
      'variant',
      'activate',
      'status',
      'active',
      'params',
      'wandb',
      'jobId',
      'assessment',
      'reason',
      'expectedMtime',
      'expectedHash',
    ])
    for (const option of command.options)
      if (!routineOptions.has(option.attributeName())) option.hideHelp()
    command.addHelpText(
      'after',
      '\nCreation returns directory, variantId and Run id. Other metadata may be edited in run.json; publish direct edits with memon refresh E0001. CLI updates publish automatically.',
    )
  }

  createRunCommand.action(
    async (
      id: string | undefined,
      opts: RunMetadataOptions & { experiment: string; variant?: string },
    ) => {
      await runRunCreate({ ...readGlobals(), ...opts, ...(id ? { id } : {}) })
    },
  )

  updateRunCommand.action(
    async (
      target: string,
      opts: RunMetadataOptions & { expectedMtime?: number; expectedHash?: string },
    ) => {
      await runRunUpdate({ ...readGlobals(), ...opts, target })
    },
  )

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

  registerRefreshCommand(program, readGlobals)
  registerToolsCommands(program)
  registerLegacyCommands(program, experiment, run)
  return program
}
