#!/usr/bin/env node
// Normalize historical result files when their schema transforms are needed for migration.
import { promises as fs } from 'node:fs'
import {
  applySchemaUpgrade,
  planSchemaUpgrade,
  resolveExperimentId,
  withFileWriterLock,
} from '../../dist/index.js'
import { argumentsFor, runScript } from './runtime.mjs'

async function main() {
  const options = argumentsFor(
    { experiment: { type: 'string' }, to: { type: 'string' }, apply: { type: 'boolean' } },
    'node experiment-schema.mjs --project-root PROJECT --experiment E0001 --to N [--apply]',
  )
  if (!options) return
  if (!options.experiment || !/^[1-9]\d*$/.test(options.to ?? ''))
    throw new Error('--experiment and a positive integer --to are required')
  const root = await fs.realpath(options['project-root'])
  const id = await resolveExperimentId(root, options.experiment)
  if (!id) throw new Error('Experiment not found')
  const work = async () => {
    const plan = await planSchemaUpgrade(root, id, Number(options.to))
    const result = options.apply ? await applySchemaUpgrade(root, plan) : { plan }
    process.stdout.write(
      `${JSON.stringify({ ok: true, ...result, applied: options.apply === true && result.status === 'applied' }, null, 2)}\n`,
    )
  }
  if (options.apply) await withFileWriterLock(root, work)
  else await work()
}

runScript(import.meta.url, main)
