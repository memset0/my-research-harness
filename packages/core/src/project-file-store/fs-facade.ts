// project-file-store/fs-facade — `projectFs`, the `fs/promises`-compatible
// facade. Outside a project file context it delegates to the native
// filesystem; inside one it routes reads through the store and enforces
// containment and the read-only policy on every mutation.

import { type Dirent, promises as nodeFs, type PathLike, type Stats } from 'node:fs'
import type * as FsPromisesModule from 'node:fs/promises'
import { FileAccessError } from '@memon/file-protocol'
import { isWithinPath } from '../mount-table.js'
import type { ProjectFileContext } from '../project-file-context.js'
import { executeProjectIo, type MutationMethod } from '../project-io.js'
import { isAgentPath } from './agent-adapters.js'
import { AgentReadHandle } from './agent-handle.js'
import { recordAgentBytes, recordAgentMtime } from './agent-mutations.js'
import { resolveTargetPath } from './containment.js'
import { containmentError, readOnlyError } from './errors.js'
import { CachedDirent, type FileValue } from './observation.js'
import { getStore } from './runtime.js'

type ReadFileOptions = Parameters<typeof nodeFs.readFile>[1]
type ReaddirOptions = Parameters<typeof nodeFs.readdir>[1]

/** Read one option field without asserting a shape over the whole argument. */
function optionValue(options: unknown, key: string): unknown {
  if (typeof options !== 'object' || options === null) return undefined
  if (!(key in options)) return undefined
  return Reflect.get(options, key)
}

/** `'buffer'` is a valid fs encoding selector but not a `BufferEncoding`. */
type EncodingSelector = BufferEncoding | 'buffer' | null

function encodingOf(options: unknown): EncodingSelector {
  const raw = typeof options === 'string' ? options : optionValue(options, 'encoding')
  if (typeof raw !== 'string') return null
  if (raw === 'buffer') return 'buffer'
  // Node validates an unsupported encoding itself; narrowing here only selects
  // the decode path.
  const encoding = raw as BufferEncoding
  return encoding
}

/**
 * Only plain read-for-content calls are cacheable: an abort signal or a
 * non-default flag means the caller wants distinct filesystem semantics.
 */
function isCacheableReadFile(options: ReadFileOptions): boolean {
  if (options === undefined || options === null) return true
  if (typeof options === 'string') return true
  const signal = optionValue(options, 'signal')
  if (signal !== undefined && signal !== null) return false
  const flag = optionValue(options, 'flag')
  if (flag !== undefined && flag !== 'r') return false
  return true
}

function decodeFile(value: FileValue, encoding: EncodingSelector): string | Buffer {
  if (encoding === null || encoding === 'buffer') return Buffer.from(value.bytes)
  if (encoding === 'utf8' || encoding === 'utf-8') {
    if (value.text === undefined) value.text = value.bytes.toString('utf8')
    return value.text
  }
  return value.bytes.toString(encoding)
}

/**
 * Resolve the routing decision for a path. `null` means "no active context"
 * and the call delegates to the native filesystem (the CLI reads fresh).
 * Inside a context the decision fails closed: a path that is not lexically
 * inside the project root — or a target whose path cannot be determined —
 * is refused instead of silently reaching the filesystem unmediated.
 * `direct` marks a `storage: 'local'` context: contained and policed, but
 * performed on the native filesystem instead of the scheduler.
 */
function routable(
  target: PathLike,
  syscall: string,
): { context: ProjectFileContext; path: string; direct: boolean } | null {
  const context = getStore().contextStorage.getStore()
  if (context === undefined) {
    if (typeof target === 'string' && isAgentPath(target))
      throw containmentError(syscall, target, 'unconfigured authority')
    return null
  }
  const absolutePath = resolveTargetPath(target)
  if (absolutePath === null) throw containmentError(syscall, String(target), context.root)
  if (!isWithinPath(context.root, absolutePath)) {
    throw containmentError(syscall, absolutePath, context.root)
  }
  return {
    context,
    path: absolutePath,
    direct:
      !isAgentPath(absolutePath) &&
      (context.cachePolicy === 'none' ||
        (context.cachePolicy === undefined && context.storage === 'local')),
  }
}

/**
 * Honour an abort signal while an isolated read runs. The physical operation
 * itself cannot be cancelled once started — a blocked syscall could not be
 * cancelled natively either — so the caller stops waiting while the worker
 * completes and releases its slot normally.
 */
function withAbort<T>(work: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const abortError = (): Error => {
    const error = new Error('The operation was aborted', {
      cause: signal.reason,
    }) as NodeJS.ErrnoException
    error.name = 'AbortError'
    error.code = 'ABORT_ERR'
    return error
  }
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    work()
      .then(resolve, reject)
      .finally(() => signal.removeEventListener('abort', onAbort))
  })
}

async function facadeReadFile(
  target: PathLike,
  options?: ReadFileOptions,
): Promise<string | Buffer> {
  const routed = routable(target, 'readFile')
  if (routed === null || routed.direct) {
    // Direct root: the native call is the whole operation — the caller's own
    // options (abort signal, flag, encoding) apply unchanged and nothing is
    // cached, so a following read always sees the current bytes.
    return (await nodeFs.readFile(target as never, options as never)) as string | Buffer
  }
  const encoding = encodingOf(options)
  if (!isCacheableReadFile(options)) {
    // Distinct filesystem semantics (abort signal, non-default flag): not
    // cacheable, but still contained and still executed in the isolated
    // worker so it cannot block this process.
    const flag = optionValue(options, 'flag')
    const read = () =>
      getStore().rawReadFile(
        routed.context,
        routed.path,
        typeof flag === 'string' ? flag : undefined,
      )
    const signal = optionValue(options, 'signal')
    const bytes = signal instanceof AbortSignal ? await withAbort(read, signal) : await read()
    if (encoding === null || encoding === 'buffer') return bytes
    return bytes.toString(encoding)
  }
  const value = await getStore().readFileValue(routed.context, routed.path)
  if (isAgentPath(routed.path)) recordAgentBytes(routed.context, routed.path, value.bytes)
  return decodeFile(value, encoding)
}

async function facadeReaddir(
  target: PathLike,
  options?: ReaddirOptions,
): Promise<string[] | Buffer[] | Dirent[]> {
  const routed = routable(target, 'readdir')
  if (routed === null || routed.direct) {
    // A direct root has no cache entries to keep consistent, so even a
    // recursive listing is just the native walk the caller asked for.
    return (await nodeFs.readdir(target as never, options as never)) as
      | string[]
      | Buffer[]
      | Dirent[]
  }
  if (optionValue(options, 'recursive') === true) {
    throw new Error(
      'projectFs.readdir: recursive listing is not permitted inside a project file context; compose direct listings instead',
    )
  }
  const { entries } = await getStore().listDirValue(routed.context, routed.path)
  if (optionValue(options, 'withFileTypes') === true) {
    // CachedDirent implements the Dirent surface callers actually use; Node's
    // Dirent class is not publicly constructible.
    return entries.map(
      (entry) => new CachedDirent(entry.name, routed.path, entry.kind) as unknown as Dirent,
    )
  }
  if (encodingOf(options) === 'buffer') {
    return entries.map((entry) => Buffer.from(entry.name, 'utf8'))
  }
  return entries.map((entry) => entry.name)
}

async function facadeStat(target: PathLike, options?: unknown): Promise<Stats> {
  const routed = routable(target, 'stat')
  if (routed === null || routed.direct) {
    return (await nodeFs.stat(target as never, options as never)) as Stats
  }
  if (optionValue(options, 'bigint') === true) {
    if (isAgentPath(routed.path)) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    // BigInt precision is a distinct filesystem semantic, so it is observed
    // fresh rather than served from the cache — still isolated and contained.
    return await getStore().rawStat(routed.context, routed.path, 'stat')
  }
  const result = await getStore().statValue(routed.context, routed.path, 'stat')
  if (isAgentPath(routed.path)) recordAgentMtime(routed.context, routed.path, result.mtimeMs)
  return result
}

async function facadeLstat(target: PathLike, options?: unknown): Promise<Stats> {
  const routed = routable(target, 'lstat')
  if (routed === null || routed.direct) {
    return (await nodeFs.lstat(target as never, options as never)) as Stats
  }
  if (optionValue(options, 'bigint') === true) {
    if (isAgentPath(routed.path)) throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return await getStore().rawStat(routed.context, routed.path, 'lstat')
  }
  return await getStore().statValue(routed.context, routed.path, 'lstat')
}

async function facadeRealpath(target: PathLike, options?: unknown): Promise<string> {
  const routed = routable(target, 'realpath')
  if (routed === null || routed.direct) {
    return (await nodeFs.realpath(target as never, options as never)) as string
  }
  return await getStore().realpathValue(routed.context, routed.path)
}

async function facadeAccess(target: PathLike, mode?: number): Promise<void> {
  const routed = routable(target, 'access')
  if (routed === null) {
    await nodeFs.access(target as never, mode)
    return
  }
  if (isAgentPath(routed.path) && mode !== undefined && mode !== 0)
    throw new FileAccessError('CAPABILITY_UNAVAILABLE')
  const writeCheck = mode !== undefined && (mode & 2) !== 0
  if (writeCheck && routed.context.readOnly === true) throw readOnlyError('access', routed.path)
  if (routed.direct) {
    await nodeFs.access(target as never, mode)
    return
  }
  if (writeCheck) {
    await getStore().rawAccess(routed.context, routed.path, mode)
    return
  }
  await getStore().statValue(routed.context, routed.path, 'stat')
}

function isWriteFlag(flags: unknown): boolean {
  if (typeof flags === 'number') return (flags & 3) !== 0 || (flags & 0x40) !== 0
  if (typeof flags !== 'string') return false
  return flags.includes('w') || flags.includes('a') || flags.includes('+')
}

async function facadeOpen(target: PathLike, flags?: unknown, mode?: unknown): Promise<unknown> {
  const routed = routable(target, 'open')
  if (routed === null) {
    return await nodeFs.open(target as never, flags as never, mode as never)
  }
  if (routed.context.readOnly === true && isWriteFlag(flags)) {
    throw readOnlyError('open', routed.path)
  }
  if (routed.direct) {
    return await nodeFs.open(target as never, flags as never, mode as never)
  }
  if (isAgentPath(routed.path)) {
    if (flags !== undefined && flags !== 'r') throw new FileAccessError('CAPABILITY_UNAVAILABLE')
    return AgentReadHandle.open(routed.path)
  }
  if (flags !== undefined && flags !== 'r') throw new FileAccessError('CAPABILITY_UNAVAILABLE')
  return getStore().openReadHandle(routed.context, routed.path)
}

function writtenBytes(data: unknown): Buffer | null {
  if (typeof data === 'string') return Buffer.from(data, 'utf8')
  if (Buffer.isBuffer(data)) return Buffer.from(data)
  if (data instanceof Uint8Array) return Buffer.from(data)
  return null
}

async function facadeWriteFile(target: PathLike, data: unknown, options?: unknown): Promise<void> {
  const routed = routable(target, 'writeFile')
  if (routed === null) {
    await nodeFs.writeFile(target as never, data as never, options as never)
    return
  }
  if (routed.direct) {
    if (routed.context.readOnly === true) throw readOnlyError('writeFile', routed.path)
    getStore().invalidate(routed.context.root, routed.path)
    try {
      await nodeFs.writeFile(target as never, data as never, options as never)
    } finally {
      getStore().invalidate(routed.context.root, routed.path)
    }
    return
  }
  const store = getStore()
  const bytes = writtenBytes(data)
  await store.mutate(routed.context, 'writeFile', [routed.path], 'writeFile', [
    routed.path,
    data,
    options,
  ])
  const flag = optionValue(options, 'flag')
  if (flag === undefined || flag === 'w') {
    if (bytes !== null) store.adoptWrite(routed.context, routed.path, bytes)
  }
}

/**
 * The native implementations behind the mutating facade methods. Keyed by the
 * same allowlist the isolated worker uses, so a direct root performs exactly
 * the mutation the scheduled path would have delegated.
 */
const nativeMutations = nodeFs as unknown as Record<
  MutationMethod,
  (...args: unknown[]) => Promise<unknown>
>

/**
 * A mutation on one path. Outside a context, and on a direct root, it is the
 * native call (a direct root still refuses writes under the read-only
 * policy); in a scheduled context the store enforces policy, containment and
 * slot accounting, and the isolated worker performs it.
 */
function mutatingUnary(
  method: MutationMethod,
  arity: number,
): (target: PathLike, ...args: unknown[]) => Promise<unknown> {
  return async (target: PathLike, ...args: unknown[]) => {
    const forwarded = args.slice(0, arity)
    const routed = routable(target, method)
    if (routed === null) {
      return await executeProjectIo({ id: 0, op: 'mutate', method, args: [target, ...forwarded] })
    }
    if (routed.direct) {
      if (routed.context.readOnly === true) throw readOnlyError(method, routed.path)
      getStore().invalidate(routed.context.root, routed.path)
      try {
        return await nativeMutations[method](target, ...forwarded)
      } finally {
        getStore().invalidate(routed.context.root, routed.path)
      }
    }
    return await getStore().mutate(routed.context, method, [routed.path], method, [
      routed.path,
      ...forwarded,
    ])
  }
}

/** A mutation with a source and a destination (`rename`, `copyFile`, `cp`). */
function mutatingBinary(
  method: MutationMethod,
  arity: number,
): (source: PathLike, destination: PathLike, ...args: unknown[]) => Promise<unknown> {
  return async (source: PathLike, destination: PathLike, ...args: unknown[]) => {
    const forwarded = args.slice(0, arity)
    const routed = routable(source, method)
    if (routed === null) {
      return await executeProjectIo({
        id: 0,
        op: 'mutate',
        method,
        args: [source, destination, ...forwarded],
      })
    }
    if (routed.direct) {
      if (routed.context.readOnly === true) throw readOnlyError(method, routed.path)
      // The destination is contained by the same rule as the source.
      const destinationRoute = routable(destination, method)
      const destinationPath = destinationRoute?.path ?? String(destination)
      const invalidate = () => {
        getStore().invalidate(routed.context.root, routed.path)
        getStore().invalidate(routed.context.root, destinationPath)
      }
      invalidate()
      try {
        return await nativeMutations[method](source, destination, ...forwarded)
      } finally {
        invalidate()
      }
    }
    // The destination is validated by the same containment rules as the
    // source, so a linked or out-of-root target cannot receive the write.
    const destinationRoute = routable(destination, method)
    const destinationPath = destinationRoute === null ? String(destination) : destinationRoute.path
    return await getStore().mutate(routed.context, method, [routed.path, destinationPath], method, [
      routed.path,
      destinationPath,
      ...forwarded,
    ])
  }
}

const realpathFacade = Object.assign(facadeRealpath, { native: facadeRealpath })

const facadeMethods = {
  readFile: facadeReadFile,
  readdir: facadeReaddir,
  stat: facadeStat,
  lstat: facadeLstat,
  realpath: realpathFacade,
  access: facadeAccess,
  open: facadeOpen,
  writeFile: facadeWriteFile,
  appendFile: mutatingUnary('appendFile', 2),
  mkdir: mutatingUnary('mkdir', 1),
  rm: mutatingUnary('rm', 1),
  rmdir: mutatingUnary('rmdir', 1),
  unlink: mutatingUnary('unlink', 0),
  truncate: mutatingUnary('truncate', 1),
  chmod: mutatingUnary('chmod', 1),
  utimes: mutatingUnary('utimes', 2),
  rename: mutatingBinary('rename', 0),
  copyFile: mutatingBinary('copyFile', 1),
  cp: mutatingBinary('cp', 1),
}

/**
 * `fs/promises`-compatible facade. Cached + scheduled inside a project file
 * context, native passthrough outside one. Unlisted members fall through to
 * `node:fs/promises` so the type stays honest without copying every method.
 */
export const projectFs = new Proxy(facadeMethods, {
  get(target, property, receiver) {
    if (Reflect.has(target, property)) return Reflect.get(target, property, receiver)
    const value: unknown = Reflect.get(nodeFs as unknown as object, property)
    if (typeof value !== 'function') return value
    return (...args: unknown[]) => {
      const containsAuthority = args.some((argument) =>
        typeof argument === 'string'
          ? isAgentPath(argument)
          : Buffer.isBuffer(argument)
            ? isAgentPath(argument.toString('utf8'))
            : argument instanceof URL
              ? argument.protocol === 'memon-file:'
              : false,
      )
      if (containsAuthority || getStore().contextStorage.getStore() !== undefined)
        throw new FileAccessError('CAPABILITY_UNAVAILABLE')
      return Reflect.apply(value, nodeFs, args)
    }
  },
  has(target, property) {
    return Reflect.has(target, property) || Reflect.has(nodeFs as unknown as object, property)
  },
}) as unknown as typeof FsPromisesModule
