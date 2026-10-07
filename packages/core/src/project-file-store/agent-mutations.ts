import { createHash, randomUUID } from 'node:crypto'
import {
  type DirectoryFileCheckSchema,
  FileAccessError,
  type FileMutationRequest,
  isFileAccessError,
  MAX_DIRECTORY_FILE_CHECKS,
  type MutationPreconditionSchema,
} from '@memon/file-protocol'
import { join, parseFileURI } from '@memon/file-protocol/paths'
import type { z } from 'zod'
import type { ProjectFileContext } from '../project-file-context.js'
import type { MutationMethod } from '../project-io.js'
import { agentAdapter, missingAgentPath } from './agent-adapters.js'

type Precondition = z.infer<typeof MutationPreconditionSchema>
interface Snapshot {
  bytes?: Buffer
  mtime?: number
  absent?: boolean
}
const snapshots = new WeakMap<ProjectFileContext, Map<string, Snapshot>>()
function state(context: ProjectFileContext): Map<string, Snapshot> {
  let result = snapshots.get(context)
  if (!result) {
    result = new Map()
    snapshots.set(context, result)
  }
  return result
}
export function recordAgentBytes(context: ProjectFileContext, path: string, bytes: Buffer): void {
  const prior = state(context).get(path)
  state(context).set(path, { ...prior, bytes, absent: false })
}
export function recordAgentMtime(context: ProjectFileContext, path: string, mtime: number): void {
  state(context).set(path, { ...state(context).get(path), mtime, absent: false })
}
async function precondition(context: ProjectFileContext, path: string): Promise<Precondition> {
  const snapshot = state(context).get(path)
  if (snapshot?.absent) return { kind: 'absent' }
  const { adapter, target } = await agentAdapter(path)
  const metadata = await adapter.stat(target, false)
  if (metadata.outcome === 'missing') {
    if (snapshot?.bytes) throw new FileAccessError('CONFLICT')
    return { kind: 'absent' }
  }
  if (metadata.metadata.kind === 'symlink') {
    if (!metadata.metadata.identity) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return { kind: 'entry', expectedIdentity: metadata.metadata.identity }
  }
  if (metadata.metadata.kind === 'directory') {
    if (!metadata.metadata.identity) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return { kind: 'directory', expectedIdentity: metadata.metadata.identity }
  }
  let bytes = snapshot?.bytes
  if (!bytes) {
    const result = await adapter.read(target)
    if (result.outcome !== 'present') throw new FileAccessError('CONFLICT')
    bytes = Buffer.from(result.content, 'base64')
  }
  return {
    kind: 'match',
    expectedMtime: snapshot?.mtime ?? metadata.metadata.mtimeMs,
    expectedHash: createHash('sha256').update(bytes).digest('hex'),
  }
}

async function directoryChecks(
  context: ProjectFileContext,
  path: string,
): Promise<z.infer<typeof DirectoryFileCheckSchema>[]> {
  const observed = [...state(context)].filter(
    ([key, value]) => key.startsWith(`${path}/`) && value.bytes !== undefined,
  )
  if (observed.length > MAX_DIRECTORY_FILE_CHECKS) throw new FileAccessError('LIMIT_EXCEEDED')
  return Promise.all(
    observed.map(async ([key]) => {
      const expected = await precondition(context, key)
      if (expected.kind !== 'match') throw new FileAccessError('CONFLICT')
      return { path: parseFileURI(key).path, precondition: expected }
    }),
  )
}
function remapSnapshots(context: ProjectFileContext, path: string, destination: string): void {
  for (const [key, value] of [...state(context)]) {
    if (key === path || key.startsWith(`${path}/`)) {
      state(context).delete(key)
      state(context).set(destination + key.slice(path.length), value)
    }
  }
  state(context).delete(destination)
}

/** Whole-file and directory operations stay explicit at the source; no remote handle writes. */
export async function mutateAgent(
  context: ProjectFileContext,
  method: MutationMethod,
  paths: string[],
  args: unknown[],
): Promise<unknown> {
  const path = paths[0]!
  const { adapter, target } = await agentAdapter(path)
  const base = { ...target, requestId: randomUUID(), lockVersion: 1 as const }
  let request: FileMutationRequest
  switch (method) {
    case 'writeFile': {
      const options = args[2] as
        | { flag?: string; encoding?: BufferEncoding; mode?: number }
        | undefined
      if (options?.flag && !['w', 'wx'].includes(options.flag))
        throw new FileAccessError('CAPABILITY_UNAVAILABLE')
      const data = args[1]
      const bytes =
        typeof data === 'string'
          ? Buffer.from(
              data,
              typeof args[2] === 'string'
                ? (args[2] as BufferEncoding)
                : (options?.encoding ?? 'utf8'),
            )
          : Buffer.from(data as Uint8Array)
      request = {
        ...base,
        operation: 'replace',
        precondition:
          options?.flag === 'wx' ? { kind: 'absent' } : await precondition(context, path),
        content: bytes.toString('base64'),
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      }
      if (request.precondition.kind === 'directory' || request.precondition.kind === 'entry')
        throw new FileAccessError('CAPABILITY_UNAVAILABLE')
      try {
        await adapter.mutate(request)
      } catch (error) {
        if (options?.flag === 'wx' && isFileAccessError(error) && error.code === 'CONFLICT')
          throw Object.assign(new Error('Path already exists'), { code: 'EEXIST' })
        throw error
      }
      state(context).delete(path)
      return
    }
    case 'mkdir': {
      const options = args[1] as { recursive?: boolean; mode?: number } | undefined
      if (target.path === '' && options?.recursive) return
      request = {
        ...base,
        operation: 'mkdir',
        recursive: options?.recursive ?? false,
        ...(options?.mode === undefined ? {} : { mode: options.mode }),
      }
      break
    }
    case 'rename': {
      const destination = parseFileURI(paths[1]!)
      if (destination.root !== context.root) throw new FileAccessError('OUTSIDE_PROJECT')
      request = {
        ...base,
        operation: 'rename',
        destination: destination.path,
        precondition: await precondition(context, path),
        destinationPrecondition: await precondition(context, paths[1]!),
      }
      if (request.precondition.kind === 'directory')
        request.fileChecks = await directoryChecks(context, path)
      // A directory is never silently replaced; file replacement preserves its observed precondition.
      if (
        request.precondition.kind === 'directory' &&
        request.destinationPrecondition.kind !== 'absent'
      )
        throw new FileAccessError('CONFLICT')
      await adapter.mutate(request)
      remapSnapshots(context, path, paths[1]!)
      return
    }
    case 'rm':
    case 'rmdir':
    case 'unlink': {
      const options = args[1] as { recursive?: boolean; force?: boolean } | undefined
      const expected = await precondition(context, path)
      if (expected.kind === 'absent') {
        if (options?.force) return
        throw missingAgentPath(path)
      }
      if (expected.kind === 'directory' && options?.recursive) {
        const isolated = join(path, '..', `.memon-cleanup-${randomUUID()}`)
        await adapter.mutate({
          ...base,
          operation: 'rename',
          destination: parseFileURI(isolated).path,
          precondition: expected,
          destinationPrecondition: { kind: 'absent' },
          fileChecks: await directoryChecks(context, path),
        })
        remapSnapshots(context, path, isolated)
        const isolatedTarget = { ...target, path: parseFileURI(isolated).path }
        const listing = await adapter.list(isolatedTarget)
        if (listing.outcome !== 'present') throw new FileAccessError('CONFLICT')
        for (const entry of listing.entries)
          await mutateAgent(
            context,
            'rm',
            [join(isolated, entry.name)],
            [join(isolated, entry.name), options],
          )
        await mutateAgent(context, 'rmdir', [isolated], [isolated])
        state(context).delete(path)
        return
      }
      request = { ...base, operation: 'delete', precondition: await precondition(context, path) }
      break
    }
    default:
      throw new FileAccessError('CAPABILITY_UNAVAILABLE')
  }
  try {
    await adapter.mutate(request)
  } catch (error) {
    if (method === 'mkdir' && isFileAccessError(error) && error.code === 'CONFLICT')
      throw Object.assign(new Error('Path already exists'), { code: 'EEXIST' })
    throw error
  }
  state(context).delete(path)
}
