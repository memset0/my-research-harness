#!/usr/bin/env node
import { promises as fs } from 'node:fs'
import {
  applyLightweightMigration,
  planLightweightMigration,
  rebuildIndex,
  resolveExperimentId,
} from '../../dist/index.js'
import { argumentsFor, runScript } from './runtime.mjs'

async function main() {
  const options = argumentsFor(
    { experiment: { type: 'string' }, apply: { type: 'string' } },
    'node v10-to-v11.mjs --project-root PROJECT --experiment E0001 [--apply PLAN.json]',
  )
  if (!options) return
  if (!options.experiment) throw new Error('--experiment is required')
  const root = await fs.realpath(options['project-root'])
  const id = await resolveExperimentId(root, options.experiment)
  if (!id) throw new Error('Experiment not found')
  if (!options.apply) {
    process.stdout.write(`${JSON.stringify(await planLightweightMigration(root, id), null, 2)}\n`)
    return
  }
  const plan = JSON.parse(await fs.readFile(options.apply, 'utf8'))
  if (plan.experiment !== id) throw new Error('Plan names a different Experiment')
  const result = await applyLightweightMigration(root, plan)
  const index = await rebuildIndex(root, { role: 'cli' })
  if (index.status !== 'rebuilt')
    throw new Error('Migration applied; inventory incomplete. Run memon refresh.')
  process.stdout.write(
    `${JSON.stringify({ ok: true, ...result, index: index.status, markerChanged: false })}\n`,
  )
}

runScript(import.meta.url, main)
