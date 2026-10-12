import { dirname, isFileURI, join, relative } from '@memon/file-protocol/paths'
import { atomicTempPath } from '../atomic-write.js'
import {
  assertDocumentLock,
  type DocumentState,
  MutationError,
  type MutationFs,
  readDocumentState,
} from '../experiments/mutations.js'
import { parseExperimentReadme } from '../experiments/parse.js'
import { withFileWriterLock } from '../file-writer-lock.js'
import { projectFs } from '../project-file-store.js'
import { formatIsoLocal } from '../time.js'
import {
  type ExperimentDescription,
  experimentDescriptionToJson,
  parseExperimentDescription,
  researchDescriptionProblem,
  serializeExperimentDescription,
} from './description.js'

export interface ResearchTarget {
  projectRoot: string
  readmePath: string
  experimentId: string
}
export interface ResearchLock {
  expectedMtime: number
  expectedHash: string
  now?: string
}
export interface ResearchMutationResult extends DocumentState {
  description: ExperimentDescription
  previousVersion: number
  currentVersion: number
}

function requireResearch(description: ExperimentDescription) {
  if (!description.research)
    throw new MutationError(
      'BAD_STATE',
      'FS10_MIGRATION_REQUIRED: explicitly migrate this Experiment before using research versions',
    )
  return description.research
}
function reasonText(reason: string) {
  if (!reason?.trim()) throw new MutationError('BAD_REQUEST', 'A nonempty reason is required')
  return reason.trim()
}

export function initializeExperimentResearch(
  description: ExperimentDescription,
  members: readonly string[],
  now: string | Date,
  reason: string,
): ExperimentDescription {
  if (description.research)
    throw new MutationError('BAD_STATE', 'Experiment already has research versions')
  if (new Set(description.variants.map((v) => v.id)).size !== description.variants.length)
    throw new MutationError('BAD_REQUEST', 'Duplicate Variant IDs cannot be converted')
  const result = structuredClone(description)
  result.research = {
    current_version: 1,
    versions: [
      {
        version: 1,
        started_at: typeof now === 'string' ? now : formatIsoLocal(now),
        reason: reasonText(reason),
      },
    ],
    run_versions: Object.fromEntries(members.map((run) => [run, 1])),
  }
  const problem = researchDescriptionProblem(result, members)
  if (problem) throw new MutationError('BAD_REQUEST', problem)
  return result
}

export function enrollResearchRun(
  description: ExperimentDescription,
  run: string,
  version: number,
  reason: string,
  mode: 'created' | 'historical',
  now = formatIsoLocal(new Date()),
  variantId?: string,
): ExperimentDescription {
  const result = structuredClone(description)
  const ledger = requireResearch(result)
  const previous = ledger.run_versions[run]
  if (previous !== undefined) {
    if (previous !== version)
      throw new MutationError('BAD_STATE', 'Existing Run attribution cannot be changed')
    if (!variantId) return result
  }
  if (!Number.isInteger(version) || version < 1 || version > ledger.current_version)
    throw new MutationError('BAD_REQUEST', 'Unknown research version')
  if (mode === 'created' && version !== ledger.current_version)
    throw new MutationError('CONFLICT', 'Research version changed before Run creation')
  if (mode === 'historical' && version >= ledger.current_version)
    throw new MutationError('BAD_STATE', 'Historical import cannot enroll current-version evidence')
  ledger.run_versions[run] = version
  if (variantId) {
    const variant = result.variants.find((item) => item.id === variantId)
    if (!variant) throw new MutationError('NOT_FOUND', `Unknown Variant ${variantId}`)
    if (mode === 'historical') {
      const snapshot = ledger.versions.find((item) => item.version === version)?.snapshot
      const historicalVariant = (
        snapshot?.variants as Record<string, { runs?: string[] }> | undefined
      )?.[variantId]
      if (!historicalVariant)
        throw new MutationError(
          'BAD_REQUEST',
          'Variant did not exist in the selected historical definition',
        )
      historicalVariant.runs = [...new Set([...(historicalVariant.runs ?? []), run])]
    }
    if (!variant.runs.includes(run)) variant.runs.push(run)
  }
  ledger.imports = [
    ...(ledger.imports ?? []),
    { run, version, reason: reasonText(reason), imported_at: now },
  ]
  const problem = researchDescriptionProblem(result)
  if (problem) throw new MutationError('BAD_REQUEST', problem)
  return result
}

async function mutateResearchUnlocked(
  fs: MutationFs,
  target: ResearchTarget,
  lock: ResearchLock,
  change: (description: ExperimentDescription, now: string) => ExperimentDescription,
): Promise<ResearchMutationResult> {
  const rel = relative(target.projectRoot, target.readmePath)
  if (rel.startsWith('..') || rel.startsWith('/'))
    throw new MutationError('FORBIDDEN', 'Experiment path escapes project root')
  if (!Number.isFinite(lock.expectedMtime) || !lock.expectedHash)
    throw new MutationError('BAD_REQUEST', 'expectedMtime and expectedHash are required')
  const path = join(dirname(target.readmePath), 'experiment.json')
  const before = await readDocumentState(fs, path)
  assertDocumentLock(before, lock)
  const readme = await readDocumentState(fs, target.readmePath)
  const members = parseExperimentReadme(readme.content, target.experimentId).frontMatter.runs
  const description = parseExperimentDescription(before.content).data
  if (!description) throw new MutationError('BAD_STATE', 'Invalid experiment.json')
  const ledger = requireResearch(description)
  const problem = researchDescriptionProblem(description)
  if (problem) throw new MutationError('BAD_STATE', problem)
  const now = lock.now ?? formatIsoLocal(new Date())
  const next = change(description, now)
  const nextProblem = researchDescriptionProblem(next, members)
  if (nextProblem) throw new MutationError('BAD_STATE', nextProblem)
  const content = serializeExperimentDescription(next)
  if (!parseExperimentDescription(content).data)
    throw new MutationError('BAD_REQUEST', 'Invalid resulting research description')
  assertDocumentLock(await readDocumentState(fs, target.readmePath), {
    expectedMtime: readme.mtime,
    expectedHash: readme.hash,
  })
  assertDocumentLock(await readDocumentState(fs, path), lock)
  if (content !== before.content) {
    const temp = atomicTempPath(path)
    try {
      await fs.writeFile(temp, content, { encoding: 'utf8', mode: (await fs.stat(path)).mode })
      await fs.rename(temp, path)
    } finally {
      await fs.rm(temp, { force: true })
    }
  }
  return {
    ...(await readDocumentState(fs, path)),
    description: next,
    previousVersion: ledger.current_version,
    currentVersion: next.research!.current_version,
  }
}

async function mutateResearch(
  fs: MutationFs,
  target: ResearchTarget,
  lock: ResearchLock,
  change: (description: ExperimentDescription, now: string) => ExperimentDescription,
): Promise<ResearchMutationResult> {
  return withFileWriterLock(target.projectRoot, async () => {
    if (!isFileURI(target.projectRoot)) {
      const root = await projectFs.realpath(target.projectRoot)
      for (const path of [target.readmePath, join(dirname(target.readmePath), 'experiment.json')]) {
        const resolved = await projectFs.realpath(path)
        const rel = relative(root, resolved)
        if (rel.startsWith('..') || rel.startsWith('/'))
          throw new MutationError('FORBIDDEN', 'Experiment path resolves outside project root')
      }
    }
    return mutateResearchUnlocked(fs, target, lock, change)
  })
}

export function advanceExperimentResearchVersion(
  fs: MutationFs,
  target: ResearchTarget,
  input: ResearchLock & { expectedVersion: number; reason: string },
): Promise<ResearchMutationResult> {
  return mutateResearch(fs, target, input, (description, now) => {
    const ledger = requireResearch(description)
    if (ledger.current_version !== input.expectedVersion)
      throw new MutationError('CONFLICT', 'Research version changed')
    const result = structuredClone(description)
    const next = result.research!
    const snapshot = experimentDescriptionToJson(description)
    delete snapshot.research
    const reason = reasonText(input.reason)
    const old = next.versions[next.versions.length - 1]!
    old.closed_at = now
    old.superseded_reason = reason
    old.snapshot = snapshot
    next.current_version += 1
    next.versions.push({ version: next.current_version, started_at: now, reason })
    for (const variant of result.variants) delete variant.frozen
    return result
  })
}

export function setExperimentVariantDeprecation(
  fs: MutationFs,
  target: ResearchTarget,
  input: ResearchLock & {
    variantId: string
    deprecated: boolean
    reason: string
    successor?: string
  },
): Promise<ResearchMutationResult> {
  return mutateResearch(fs, target, input, (description, now) => {
    const result = structuredClone(description)
    const variant = result.variants.find((v) => v.id === input.variantId)
    if (!variant) throw new MutationError('NOT_FOUND', `Unknown Variant ${input.variantId}`)
    const reason = reasonText(input.reason)
    if (variant.deprecation)
      variant.deprecation_history = [
        ...(variant.deprecation_history ?? []),
        {
          ...variant.deprecation,
          ...(!input.deprecated ? { restored_at: now, restore_reason: reason } : {}),
        },
      ]
    variant.deprecated = input.deprecated
    if (input.deprecated)
      variant.deprecation = {
        reason,
        deprecated_at: now,
        ...(input.successor ? { successor: input.successor } : {}),
      }
    else delete variant.deprecation
    const problem = researchDescriptionProblem(result)
    if (problem) throw new MutationError('BAD_REQUEST', problem)
    return result
  })
}

export async function importExperimentResearchRun(
  fs: MutationFs,
  target: ResearchTarget,
  input: ResearchLock & { run: string; version: number; reason: string; variantId?: string },
): Promise<ResearchMutationResult> {
  const relativeRun = input.run
  if (
    relativeRun.startsWith('/') ||
    relativeRun.split('/').some((part) => !part || part === '..' || part === '.')
  )
    throw new MutationError('BAD_REQUEST', 'Invalid Run path')
  const runReadme = join(target.projectRoot, relativeRun, 'README.md')
  if (!isFileURI(target.projectRoot)) {
    const resolved = await projectFs.realpath(runReadme)
    const root = await projectFs.realpath(target.projectRoot)
    const rel = relative(root, resolved)
    if (rel.startsWith('..') || rel.startsWith('/'))
      throw new MutationError('FORBIDDEN', 'Run resolves outside project root')
  }
  await fs.readFile(runReadme, 'utf8')
  return mutateResearch(fs, target, input, (description, now) =>
    enrollResearchRun(
      description,
      input.run,
      input.version,
      input.reason,
      'historical',
      now,
      input.variantId,
    ),
  )
}

export { assertResearchDescriptionEdit } from './description.js'
