import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  activateLightweightRun,
  createRunMetadata,
  formatIsoLocal,
  formatRunStamp,
  lightweightRunIdentity,
  lightweightRunPath,
  nodeMutationFs,
  parseExperimentDescription,
  RUN_METADATA_FILE,
  type RunMetadata,
  readDocumentState,
  readLightweightRunRecords,
  resolveExperimentId,
  resolveRunTarget,
  serializeRunMetadata,
  updateRunMetadata,
} from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { runWalkOptions } from '../lib/discovery-options.js'
import { emitErrorAndExit } from '../lib/emit-error.js'
import { indexWarningFields } from '../lib/index-sink.js'
import { withCliWriterLock } from '../lib/invocation.js'
import { publishLightweightWrite } from '../lib/lightweight-publication.js'
import { cliMutation } from '../lib/mutation-error.js'
import { emitJson, type OutputFormat } from '../lib/output.js'

export interface RunMetadataOptions {
  status?: string
  name?: string
  createdAt?: string
  startedAt?: string
  finishedAt?: string
  host?: string
  pid?: number
  gpus?: string
  entry?: string
  command?: string
  wandb?: string
  jobId?: string
  scheduler?: string
  active?: string
  params?: string
  description?: string
  assessment?: string
  reason?: string
}

export function metadataPatch(input: RunMetadataOptions): Partial<RunMetadata> {
  const patch: Record<string, unknown> = {}
  if (input.active !== undefined) {
    if (!['true', 'false'].includes(input.active))
      emitErrorAndExit('BAD_REQUEST', '--active must be true or false')
    patch.active = input.active === 'true'
  }
  if (input.params !== undefined) {
    try {
      patch.params = JSON.parse(input.params)
    } catch {
      emitErrorAndExit('BAD_REQUEST', '--params must be a JSON object')
    }
  }
  if (input.description !== undefined) patch.description = input.description
  if (input.assessment === 'clear') patch.assessment = undefined
  else if (input.assessment !== undefined) {
    if (!input.reason) emitErrorAndExit('BAD_REQUEST', '--assessment requires --reason')
    patch.assessment = { kind: input.assessment, reason: input.reason }
  } else if (input.reason !== undefined)
    emitErrorAndExit('BAD_REQUEST', '--reason requires --assessment')
  const fields = {
    status: 'status',
    name: 'name',
    createdAt: 'created_at',
    startedAt: 'started_at',
    finishedAt: 'finished_at',
    host: 'host',
    pid: 'pid',
    entry: 'entry',
    command: 'command',
    wandb: 'wandb',
  } as const
  for (const [option, field] of Object.entries(fields)) {
    const value = input[option as keyof typeof fields]
    if (value !== undefined) patch[field] = value
  }
  if (input.gpus !== undefined)
    patch.gpus = input.gpus
      .split(',')
      .filter((part) => part.trim() !== '')
      .map(Number)
  if (input.jobId !== undefined)
    patch.scheduler = {
      job_id: input.jobId,
      ...(input.scheduler ? { system: input.scheduler } : {}),
    }
  else if (input.scheduler !== undefined)
    emitErrorAndExit('BAD_REQUEST', '--scheduler requires --job-id')
  return patch as Partial<RunMetadata>
}

export function newRunMetadata(id: string, input: RunMetadataOptions): RunMetadata {
  const now = formatIsoLocal(new Date())
  const metadata = {
    id,
    status: 'READY',
    active: false,
    created_at: now,
    ...metadataPatch(input),
  } as RunMetadata
  if (metadata.status === 'RUNNING') metadata.started_at ??= now
  try {
    serializeRunMetadata(metadata)
  } catch (error) {
    emitErrorAndExit('BAD_REQUEST', (error as Error).message)
  }
  return metadata
}

export async function runRunCreate(
  input: RunMetadataOptions & {
    projectRoot?: string
    cwd: string
    format: OutputFormat
    experiment: string
    variant?: string
    id?: string
    activate?: boolean
  },
): Promise<void> {
  const context = await resolveContext(input)
  const root = await fs.realpath(singleProjectRoot(context))
  await withCliWriterLock(root, async () => {
    const experiment = await resolveExperimentId(root, input.experiment)
    if (!experiment) emitErrorAndExit('NOT_FOUND', `Experiment ${input.experiment} not found`)
    const experimentId = experiment.slice(0, 5)
    const descriptionPath = join(root, 'docs', 'experiments', experiment, 'experiment.json')
    const description = parseExperimentDescription(await fs.readFile(descriptionPath, 'utf8')).data
    if (!description || description.format !== 'lightweight')
      emitErrorAndExit(
        'BAD_REQUEST',
        'run create requires a lightweight Experiment; migrate the Experiment explicitly first',
      )
    let variantId = input.variant
    if (variantId === undefined) {
      // Allocation and creation share the writer lock, including concurrent CLI processes.
      await readLightweightRunRecords(root, experiment)
      const directories = await fs.readdir(join(root, 'logs', experimentId)).catch((error) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      const ids = [...directories, ...description.variants.map((variant) => variant.id)]
      const next =
        Math.max(0, ...ids.filter((id) => /^V\d{4}$/.test(id)).map((id) => Number(id.slice(1)))) + 1
      if (next > 9999) emitErrorAndExit('BAD_STATE', 'No available four-digit Variant ID')
      variantId = `V${String(next).padStart(4, '0')}`
    }
    if (!/^(?:V\d{4}|smoke)$/.test(variantId))
      emitErrorAndExit('BAD_REQUEST', '--variant must be V followed by four digits, or smoke')
    if (variantId === 'V0000')
      emitErrorAndExit('BAD_REQUEST', 'Use smoke as the smoke directory name')
    const id = input.id ?? `run-${randomUUID().slice(0, 8)}-${formatRunStamp(new Date())}`
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id))
      emitErrorAndExit(
        'BAD_REQUEST',
        'Run ID must contain only letters, digits, dots, underscores and hyphens',
      )
    const path = lightweightRunPath(experimentId, variantId, id)
    if (!lightweightRunIdentity(path) || basename(id) !== id)
      emitErrorAndExit('BAD_REQUEST', 'Run id must be a safe directory basename')
    const metadata = newRunMetadata(id, input)
    metadata.active = false
    if (
      description.variants.find((variant) => variant.id === variantId)?.deprecated &&
      input.active !== 'false'
    )
      emitErrorAndExit(
        'BAD_STATE',
        'Variant is deprecated; restore its Experiment setting or create an inactive historical Run',
      )
    if (
      input.active === 'true' &&
      variantId !== 'smoke' &&
      !input.activate &&
      !description.variants.find((variant) => variant.id === variantId)?.aggregate
    ) {
      const { records } = await readLightweightRunRecords(root, experiment)
      if (
        Object.entries(records).some(
          ([key, record]) => key.startsWith(`logs/${experimentId}/${variantId}/`) && record.active,
        )
      )
        emitErrorAndExit(
          'BAD_STATE',
          'Another Run is active; use --activate to replace it or configure custom aggregation',
        )
    }
    const result = await cliMutation(() =>
      createRunMetadata({
        projectRoot: root,
        runDir: join(root, path),
        metadata,
      }),
    )
    const selection =
      input.active === 'false'
        ? null
        : await cliMutation(() =>
            activateLightweightRun({
              projectRoot: root,
              experimentId: experiment,
              variantId,
              runId: id,
              replace: input.activate,
              allowMultiple: input.active === 'true',
            }),
          )
    const publication = await publishLightweightWrite(root, path, [
      ...result.changes,
      ...(selection?.changes ?? []),
    ])
    const finalState = await readDocumentState(nodeMutationFs, result.path)
    emitJson({
      ok: true,
      id,
      experimentId: experiment,
      variantId,
      directory: path,
      path: relative(root, result.path),
      mtime: finalState.mtime,
      hash: finalState.hash,
      created: true,
      selected: selection?.selected ?? false,
      ...indexWarningFields({
        indexWarnings: [...publication],
      }),
    })
  })
}

export async function runRunUpdate(
  input: RunMetadataOptions & {
    projectRoot?: string
    cwd: string
    format: OutputFormat
    target: string
    expectedMtime?: number
    expectedHash?: string
    activate?: boolean
  },
): Promise<void> {
  const context = await resolveContext(input)
  const root = await fs.realpath(singleProjectRoot(context))
  await withCliWriterLock(root, async () => {
    const run = await resolveRunTarget(root, input.target, runWalkOptions())
    if (!run) emitErrorAndExit('NOT_FOUND', `Run ${input.target} not found`)
    if (run.recordFormat !== 'json')
      emitErrorAndExit(
        'BAD_REQUEST',
        'This command updates run.json; migrate the legacy Run explicitly first',
      )
    const path = join(run.path, RUN_METADATA_FILE)
    const state = await readDocumentState(nodeMutationFs, path)
    const patch = metadataPatch(input)
    // Activation is serialized across peers and cannot accidentally create a second selection.
    const activate = patch.active === true || input.activate
    if (activate) delete patch.active
    const result = await cliMutation(() =>
      updateRunMetadata({
        fs: nodeMutationFs,
        path,
        patch,
        lock: {
          expectedMtime: input.expectedMtime ?? state.mtime,
          expectedHash: input.expectedHash ?? state.hash,
        },
      }),
    )
    const identity = lightweightRunIdentity(relative(root, run.path))!
    const experimentId = await resolveExperimentId(root, identity.experimentId)
    const selection = activate
      ? await cliMutation(() =>
          activateLightweightRun({
            projectRoot: root,
            experimentId: experimentId!,
            variantId: identity.variantId,
            runId: identity.runId,
            replace: input.activate,
            allowMultiple: input.active === 'true',
          }),
        )
      : null
    if (activate && !selection?.selected)
      emitErrorAndExit(
        'BAD_STATE',
        'Another Run is active; use --activate to replace it, or configure custom aggregation and explicitly edit active flags',
      )
    const publication = await publishLightweightWrite(root, relative(root, run.path), [
      ...result.changes,
      ...(selection?.changes ?? []),
    ])
    const finalState = await readDocumentState(nodeMutationFs, path)
    emitJson({
      ok: true,
      id: run.id,
      path: relative(root, path),
      mtime: finalState.mtime,
      hash: finalState.hash,
      ...indexWarningFields({ indexWarnings: publication }),
    })
  })
}
