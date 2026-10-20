import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { runIndexRebuild } from './derived-index.js'
import { runExperimentResultsRebuild } from './experiment-results.js'
import type { ResultsCommandGlobals } from './results-commands.js'

/** Publish direct file edits without requiring field-by-field CLI mutations. */
export async function runRefresh(
  input: ResultsCommandGlobals & { experiments: string[] },
): Promise<void> {
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
      'publish edited Experiment results and records; no targets: rebuild inventory only',
    )
    .action(async (experiments: string[]) => {
      await runRefresh({ ...globals(), experiments })
    })
}
