import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { runIndexCheck, runIndexRebuild } from './derived-index.js'
import { runExperimentResultsRebuild } from './experiment-results.js'
import type { ResultsCommandGlobals } from './results-commands.js'

/** Publish direct file edits without requiring field-by-field CLI mutations. */
export async function runRefresh(
  input: ResultsCommandGlobals & { experiments: string[]; check?: boolean },
): Promise<void> {
  if (input.check) {
    if (input.experiments.length)
      emitErrorAndExit('BAD_REQUEST', '--check takes no Experiment targets')
    await runIndexCheck(input)
    return
  }
  if (input.experiments.length) {
    await runExperimentResultsRebuild({ ...input, targets: input.experiments, all: false })
    return
  }
  const root = singleProjectRoot(await resolveContext(input))
  await withCliWriterLock(root, () => runIndexRebuild({ ...input, validate: true }))
}

export function registerRefreshCommand(
  program: Command,
  globals: () => ResultsCommandGlobals,
): void {
  program
    .command('refresh [experiments...]')
    .description(
      'no targets: republish the whole index (Experiment, Wiki and Report catalogs); with Experiment targets: recompute only their results and records',
    )
    .option(
      '--check',
      'compare the published index with the files without writing; exit 1 unless current',
    )
    .addHelpText(
      'after',
      '\nRun at the project source after any direct create, edit, move or delete of Experiment,\nWiki or Report files. A document that cannot be indexed refuses the whole refresh:\nnothing is written and every problem is listed.',
    )
    .action(async (experiments: string[], options: { check?: boolean }) => {
      await runRefresh({ ...globals(), experiments, check: options.check === true })
    })
}
