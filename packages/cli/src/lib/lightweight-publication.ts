import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  aggregateLightweightExperiment,
  exportLightweightRunCsv,
  type IndexEventWarning,
  type IndexedFileChange,
  lightweightRunIdentity,
  parseExperimentDescription,
  parseRunMetadata,
  publishMutationEvent,
  resolveExperimentId,
  setLightweightPublicationError,
  writeFileAtomic,
} from '@memon/core'
import { cliIndexSink } from './index-sink.js'

/** Called under the project writer lock, after a primary record/result write. */
export async function publishLightweightWrite(
  root: string,
  runPath: string,
  primary: readonly IndexedFileChange[],
): Promise<IndexEventWarning[]> {
  const identity = lightweightRunIdentity(runPath)
  if (!identity) return publishMutationEvent(cliIndexSink(root), 'run.update', primary)
  const changes = [...primary]
  const warnings: IndexEventWarning[] = []
  let experimentId: string | null = null
  try {
    experimentId = await resolveExperimentId(root, identity.experimentId)
    if (!experimentId) throw new Error('Owning Experiment is missing')
    await setLightweightPublicationError(
      root,
      experimentId,
      'Run saved; refreshing results. Rerun experiment results rebuild if interrupted.',
    )
    const experimentDir = join(root, 'docs/experiments', experimentId)
    const description = parseExperimentDescription(
      await fs.readFile(join(experimentDir, 'experiment.json'), 'utf8'),
    ).data
    if (description?.format !== 'lightweight')
      throw new Error('Owning Experiment is not lightweight')
    const record = parseRunMetadata(await fs.readFile(join(root, runPath, 'run.json'), 'utf8')).data
    if (!record) throw new Error('Invalid run.json')
    const path = join(root, runPath, 'result.csv')
    const before = await fs.readFile(path, 'utf8').catch((error) => {
      if (error.code === 'ENOENT') return null
      throw error
    })
    const after = exportLightweightRunCsv(record, before, description.columns)
    if (after !== before) await writeFileAtomic(path, after, { fs })
    changes.push({ path, after })
    const result = await aggregateLightweightExperiment({ projectRoot: root, experimentId })
    changes.push({ path: result.path, after: result.content })
    // Aggregation also exports active peers. Re-register their final result facts.
    for (const change of primary) {
      if (change.path.endsWith('/run.json') && dirname(change.path) !== join(root, runPath)) {
        const resultPath = join(dirname(change.path), 'result.csv')
        const csv = await fs.readFile(resultPath, 'utf8').catch(() => null)
        if (csv !== null) changes.push({ path: resultPath, after: csv })
      }
    }
  } catch (error) {
    if (experimentId)
      await setLightweightPublicationError(root, experimentId, (error as Error).message)
    warnings.push({
      code: 'INDEX_EVENT_FAILED',
      incomplete: true,
      message: `Run saved, result publication incomplete: ${(error as Error).message}. Repair with memon experiment results rebuild ${identity.experimentId}.`,
    })
  }
  return [...warnings, ...(await publishMutationEvent(cliIndexSink(root), 'run.publish', changes))]
}
