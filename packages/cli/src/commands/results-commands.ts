import type { Command } from 'commander'
import { runExperimentSchemaUpgrade } from './experiment-schema.js'
export interface ResultsCommandGlobals {
  projectRoot?: string
  format: 'json' | 'human'
  cwd: string
}
export function registerLegacySchemaCommand(
  experiment: Command,
  globals: () => ResultsCommandGlobals,
): void {
  const schema = experiment
    .command('schema')
    .description('Experiment result-schema commands: upgrade <id> --to <N> [--apply]')
  schema
    .command('upgrade <id-or-slug>')
    .description(
      'upgrade experiment.json and every member result.csv to experiment_schema_version N through schema-upgrades/ (dry run unless --apply)',
    )
    .requiredOption('--to <N>', 'target experiment_schema_version')
    .option('--apply', 'back up, rewrite atomically, verify and roll back on failure', false)
    .action(async (idOrSlug: string, opts: { to: string; apply?: boolean }) => {
      await runExperimentSchemaUpgrade({
        ...globals(),
        idOrSlug,
        to: opts.to,
        apply: opts.apply === true,
      })
    })
}
