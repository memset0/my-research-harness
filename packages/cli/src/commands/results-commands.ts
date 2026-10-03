// Commander registration of the FS v9 Results command families:
//
//   memon experiment results {show, table, summary, rebuild, annotation get|set}
//   memon experiment schema upgrade <id> --to <N> [--apply]
//   memon run result {get, set, lint}
//
// Kept apart from `index.ts` so the help listing is testable without running
// the entry point.

import type { Command } from 'commander'
import { runExperimentDocumentShow } from './experiment-document.js'
import {
  runExperimentResults,
  runExperimentResultsAnnotationGet,
  runExperimentResultsAnnotationSet,
  runExperimentResultsRebuild,
  runExperimentResultsSummary,
} from './experiment-results.js'
import { runExperimentSchemaUpgrade } from './experiment-schema.js'
import { runRunResultGet, runRunResultLint, runRunResultSet } from './run-result.js'

export interface ResultsCommandGlobals {
  projectRoot?: string
  format: 'json' | 'human'
  cwd: string
}

const collect = (value: string, previous: string[] = []) => [...previous, value]

export function registerExperimentResultsCommands(
  experiment: Command,
  globals: () => ResultsCommandGlobals,
): void {
  const results = experiment
    .command('results')
    .description(
      'Results commands: table, summary, rebuild, annotation get|set (generated from experiment.json and member result.csv files)',
    )
  results
    .command('show <id-or-slug>')
    .description('render the Results section (the generated summary) as Markdown or JSON')
    .action(async (idOrSlug: string) => {
      await runExperimentDocumentShow({ ...globals(), idOrSlug, section: 'results' })
    })
  results
    .command('table <id-or-slug>')
    .description('read the Variant table from the Results summary with row/column filtering')
    .option('--variant <ids>', 'comma-separated Variant IDs to include (default: all)')
    .option(
      '--status <statuses>',
      'comma-separated effective statuses to include, case-insensitive (default: all)',
    )
    .option('--column <paths>', 'comma-separated column paths or group prefixes (default: all)')
    .option('--group <group>', 'column partition filter: parameter | metric | all', 'all')
    .option('--output <fmt>', 'output format: json | human | csv | markdown | yaml', 'json')
    .action(
      async (
        idOrSlug: string,
        opts: {
          variant?: string
          status?: string
          column?: string
          group?: string
          output?: string
        },
      ) => {
        await runExperimentResults({
          ...globals(),
          idOrSlug,
          variants: opts.variant,
          statuses: opts.status,
          columns: opts.column,
          columnGroup: opts.group ?? 'all',
          output: opts.output ?? 'json',
        })
      },
    )
  results
    .command('summary <id-or-slug>')
    .description('show Results columns and Variant identities without cell values')
    .option('--output <fmt>', 'output format: json | human | markdown', 'json')
    .action(async (idOrSlug: string, opts: { output?: string }) => {
      await runExperimentResultsSummary({ ...globals(), idOrSlug, output: opts.output ?? 'json' })
    })
  results
    .command('rebuild [id-or-slug]')
    .description(
      'regenerate Results summaries under .memon/index/results/ (one Experiment, or every one with --all)',
    )
    .option('--all', 'rebuild the summary of every Experiment', false)
    .action(async (idOrSlug: string | undefined, opts: { all?: boolean }) => {
      await runExperimentResultsRebuild({
        ...globals(),
        ...(idOrSlug === undefined ? {} : { idOrSlug }),
        all: opts.all === true,
      })
    })
  const annotation = results
    .command('annotation')
    .description('read or optionally update column/value descriptions in experiment.json')
  annotation
    .command('get <id-or-slug>')
    .description('read all annotations or select one column/value description')
    .option('--column <path>', 'select one Results column path')
    .option('--value <value>', 'select one described value (requires --column)')
    .action(async (idOrSlug: string, opts: { column?: string; value?: string }) => {
      await runExperimentResultsAnnotationGet({
        ...globals(),
        idOrSlug,
        column: opts.column,
        value: opts.value,
      })
    })
  annotation
    .command('set <id-or-slug> <column-path>')
    .description('add or replace a Markdown column/value description in experiment.json')
    .option('--value <value>', 'describe this value instead of the whole column')
    .requiredOption('--description <markdown>', 'Markdown description to write')
    .action(
      async (idOrSlug: string, column: string, opts: { value?: string; description: string }) => {
        await runExperimentResultsAnnotationSet({
          ...globals(),
          idOrSlug,
          column,
          value: opts.value,
          description: opts.description,
        })
      },
    )

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

export function registerRunResultCommands(
  run: Command,
  globals: () => ResultsCommandGlobals,
): void {
  const result = run
    .command('result')
    .description("a Run's result.csv: get, set (atomic upsert) and lint")
  result
    .command('get <run>')
    .description('print the parsed rows of the result file (read-only)')
    .option('--path <path>', 'only rows at or below this path')
    .action(async (target: string, opts: { path?: string }) => {
      await runRunResultGet({
        ...globals(),
        run: target,
        ...(opts.path ? { path: opts.path } : {}),
      })
    })
  result
    .command('set <run> [assignments...]')
    .description(
      'upsert <path>=<value> and <path>:<stat>=<value> rows atomically (types checked against experiment.json first)',
    )
    .option('--from <csv>', 'read rows from a path,stat,value CSV file (- for stdin)')
    .option('--unset <pair>', 'remove <path> or <path>:<stat> (repeatable)', collect, [])
    .option('--expected-hash <sha256>', 'refuse with CONFLICT unless the file still has this hash')
    .action(
      async (
        target: string,
        assignments: string[],
        opts: { from?: string; unset?: string[]; expectedHash?: string },
      ) => {
        await runRunResultSet({
          ...globals(),
          run: target,
          assignments,
          unset: opts.unset ?? [],
          ...(opts.from === undefined ? {} : { from: opts.from }),
          ...(opts.expectedHash === undefined ? {} : { expectedHash: opts.expectedHash }),
        })
      },
    )
  result
    .command('lint <run>')
    .description('lint the result file against its Experiment (read-only)')
    .action(async (target: string) => {
      await runRunResultLint({ ...globals(), run: target })
    })
}
