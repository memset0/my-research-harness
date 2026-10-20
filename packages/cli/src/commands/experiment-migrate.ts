import { promises as fs } from 'node:fs'
import {
  applyLightweightMigration,
  planLightweightMigration,
  rebuildIndex,
  resolveExperimentId,
} from '@memon/core'
import type { Command } from 'commander'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { emitJson } from '../lib/output.js'
import type { ResultsCommandGlobals } from './results-commands.js'

export function registerExperimentMigration(
  experiment: Command,
  globals: () => ResultsCommandGlobals,
) {
  experiment
    .command('migrate <id>')
    .description(
      'plan one legacy Experiment conversion; --apply reads an edited plan, never converts the whole project',
    )
    .option('--apply <plan.json>', 'apply this scoped plan with source-hash checks and rollback')
    .action(async (id: string, options: { apply?: string }) => {
      const input = globals()
      const root = singleProjectRoot(await resolveContext(input))
      const resolved = await resolveExperimentId(root, id)
      if (!resolved) emitErrorAndExit('NOT_FOUND', 'Experiment not found')
      await withCliWriterLock(root, async () => {
        if (!options.apply) {
          emitJson(await planLightweightMigration(root, resolved))
          return
        }
        const plan = JSON.parse(await fs.readFile(options.apply, 'utf8'))
        if (plan.experiment !== resolved)
          emitErrorAndExit('BAD_REQUEST', 'Plan names a different Experiment')
        const result = await applyLightweightMigration(root, plan)
        const index = await rebuildIndex(root, { role: 'cli' })
        if (index.status !== 'rebuilt')
          emitErrorAndExit(
            'CONFLICT',
            'Migration applied; inventory incomplete. Run memon index rebuild.',
          )
        emitJson({ ok: true, ...result, index: index.status, markerChanged: false })
      })
    })
}
