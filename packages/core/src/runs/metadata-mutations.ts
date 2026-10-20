import { randomUUID } from 'node:crypto'
import { promises as nativeFs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { publishMutationEvent } from '../derived-index/mutation-events.js'
import {
  assertDocumentLock,
  type DocumentLock,
  indexEventWarnings,
  type MutationBase,
  MutationError,
  readDocumentState,
  replaceDocumentAtomic,
  sha1,
} from '../experiments/mutations.js'
import { formatIsoLocal } from '../time.js'
import {
  parseRunMetadata,
  RUN_METADATA_FILE,
  type RunMetadata,
  serializeRunMetadata,
} from './metadata.js'

/** Native CLI creation: contain even missing paths before making directories. */
export async function createRunMetadata(input: {
  projectRoot: string
  runDir: string
  metadata: RunMetadata
  index?: MutationBase['index']
}) {
  const root = await nativeFs.realpath(input.projectRoot)
  const directory = resolve(input.runDir)
  const inside = (path: string) => {
    const rel = relative(root, path)
    if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel))
      throw new MutationError('BAD_REQUEST', 'Run path escapes project root')
  }
  inside(directory)
  let ancestor = directory
  while (true) {
    try {
      inside(await nativeFs.realpath(ancestor))
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      ancestor = dirname(ancestor)
      if (ancestor === root) break
    }
  }
  if (input.metadata.id !== basename(directory))
    throw new MutationError('BAD_REQUEST', 'Run id must match its directory')
  const content = serializeRunMetadata(input.metadata)
  await nativeFs.mkdir(directory, { recursive: true })
  inside(await nativeFs.realpath(directory))
  const path = join(directory, RUN_METADATA_FILE)
  try {
    await nativeFs.lstat(join(directory, 'README.md'))
    throw new MutationError('CONFLICT', 'Run already has a legacy README; migrate explicitly')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const temporary = join(directory, `.run-${randomUUID()}.tmp`)
  try {
    await nativeFs.writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await nativeFs.link(temporary, path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new MutationError('CONFLICT', 'Run metadata already exists')
    throw error
  } finally {
    await nativeFs.rm(temporary, { force: true })
  }
  const stat = await nativeFs.stat(path)
  const changes = [{ path, before: null, after: content }]
  return {
    path,
    content,
    mtime: stat.mtimeMs,
    hash: sha1(content),
    changes,
    indexWarnings: await publishMutationEvent(input.index, 'run.create', changes),
  }
}

export interface UpdateRunMetadataInput extends MutationBase {
  /** Caller resolves this path through its containment boundary. */
  path: string
  patch: Partial<RunMetadata>
  lock: Required<DocumentLock>
}

export async function updateRunMetadata(input: UpdateRunMetadataInput) {
  const state = await readDocumentState(input.fs, input.path)
  assertDocumentLock(state, input.lock)
  const parsed = parseRunMetadata(state.content)
  if (!parsed.data)
    throw new MutationError('BAD_STATE', 'Invalid run.json', { details: { issues: parsed.issues } })
  const before = parsed.data
  if (input.patch.id !== undefined && input.patch.id !== before.id)
    throw new MutationError('BAD_REQUEST', 'Run identity cannot change in a metadata update')
  const metadata = { ...before, ...input.patch }
  if (input.patch.params !== undefined)
    metadata.params = { ...before.params, ...input.patch.params }
  if (
    input.patch.params !== undefined &&
    metadata.status === 'RESUME_READY' &&
    before.started_at &&
    JSON.stringify(before.params) !== JSON.stringify(metadata.params)
  )
    throw new MutationError(
      'BAD_REQUEST',
      'Keep executed parameters with their measurements; prepare changed conditions in a new Run',
    )
  try {
    serializeRunMetadata(metadata)
  } catch (error) {
    throw new MutationError('BAD_REQUEST', (error as Error).message)
  }
  if (serializeRunMetadata(metadata) === serializeRunMetadata(before)) {
    return {
      changed: false,
      metadata: before,
      previous: before,
      ...state,
      changes: [],
      indexWarnings: undefined,
    }
  }
  const now = formatIsoLocal((input.now ?? (() => new Date()))())
  if (metadata.status !== before.status) {
    if (metadata.status === 'RUNNING') {
      if (metadata.archived)
        throw new MutationError('FORBIDDEN', 'Archived Run cannot become RUNNING', {
          reason: 'ARCHIVED_RUNNING',
        })
      metadata.started_at ??= now
    }
    if (metadata.status === 'RUNNING') metadata.finished_at = null
    else if (['FINISHED', 'FAILED', 'INTERRUPTED'].includes(metadata.status))
      metadata.finished_at ??= now
  }
  metadata.updated_at = now
  const content = serializeRunMetadata(metadata)
  // Check again immediately before publication; common writers serialize under the project lock.
  assertDocumentLock(await readDocumentState(input.fs, input.path), input.lock)
  await replaceDocumentAtomic(input.fs, input.path, content)
  const stat = await input.fs.stat(input.path)
  const changes = [{ path: input.path, before: state.content, after: content }]
  return {
    changed: true,
    metadata,
    previous: before,
    content,
    mtime: stat.mtimeMs,
    hash: sha1(content),
    changes,
    ...(await indexEventWarnings(input, 'run.update', changes)),
  }
}
