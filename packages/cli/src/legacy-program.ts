import type { Command } from 'commander'
import { runExperimentArchiveDoc, runExperimentUnarchiveDoc } from './commands/experiment-doc.js'
import { runRunRecord } from './commands/run-record.js'
import { readGlobalsFor } from './lib/program.js'

export function registerLegacyCommands(program: Command, experiment: Command, run: Command): void {
  const readGlobals = () => readGlobalsFor(program)
  experiment
    .command('archive <id>')
    .description('set an Experiment lifecycle to ARCHIVED')
    .action(async (id: string) => {
      await runExperimentArchiveDoc({ ...readGlobals(), experimentId: id })
    })
  experiment
    .command('unarchive <id>')
    .description('restore an Experiment lifecycle to ACTIVE')
    .action(async (id: string) => {
      await runExperimentUnarchiveDoc({ ...readGlobals(), experimentId: id })
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
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return ''
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}
