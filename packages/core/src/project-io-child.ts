// project-io-child — the isolated executor for physical project filesystem
// operations. See `project-io.ts` for why this process exists.
//
// Two properties of this file are deliberate and must be preserved:
//
//   * It has NO runtime imports besides `node:*`. The parent spawns it from
//     compiled output (`dist/project-io-child.js`) or straight from source
//     (`src/project-io-child.ts`, run through Node's type stripping), and a
//     relative `./x.js` specifier cannot resolve in both. Type-only imports
//     are erased, so the protocol types are still shared.
//   * It retains only bounded expiring read descriptors; no content cache or queue. Every path arriving
//     here was already contained and authorized by the parent, and every
//     result is answered as plain data. Adding a cache here would create a
//     second, unaccounted copy of the project.

import { randomUUID } from 'node:crypto'
import { type Dirent, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  DirEntryKind,
  MutationMethod,
  ProjectIoRequest,
  ProjectIoResponse,
  SerializedErrno,
  StatsFields,
} from './project-io.js'

type MutationRunner = (...args: unknown[]) => Promise<unknown>

const MUTATION_METHODS: Record<MutationMethod, true> = {
  writeFile: true,
  appendFile: true,
  mkdir: true,
  rm: true,
  rmdir: true,
  unlink: true,
  truncate: true,
  chmod: true,
  utimes: true,
  rename: true,
  copyFile: true,
  cp: true,
}

function direntKindOf(entry: Dirent): DirEntryKind {
  return entry.isFile()
    ? 'file'
    : entry.isDirectory()
      ? 'directory'
      : entry.isSymbolicLink()
        ? 'symlink'
        : 'other'
}

/** Parent-side `realpathNearest`; keep the two copies in step. */
async function realpathNearest(target: string): Promise<string> {
  const tail: string[] = []
  let candidate = target
  for (;;) {
    try {
      const real = await fs.realpath(candidate)
      return tail.length === 0 ? real : join(real, ...tail)
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      const parent = dirname(candidate)
      if ((code === 'ENOENT' || code === 'ENOTDIR') && parent !== candidate) {
        tail.unshift(basename(candidate))
        candidate = parent
        continue
      }
      throw error
    }
  }
}

const readLeases = new Map<
  string,
  {
    file: Awaited<ReturnType<typeof fs.open>>
    fields: StatsFields
    deadline: number
    active: number
    closing: boolean
  }
>()
const READ_LEASE_MS = 5 * 60 * 1000
async function closeLease(token: string) {
  const lease = readLeases.get(token)
  if (!lease || (lease.closing && lease.active !== 0)) return
  lease.closing = true
  if (lease.active !== 0) return
  lease.active = -1
  try {
    await lease.file.close()
  } finally {
    readLeases.delete(token)
  }
}
const leaseSweep = setInterval(() => {
  for (const [token, lease] of readLeases)
    if (!lease.closing && lease.deadline <= Date.now())
      void closeLease(token).catch(() => undefined)
}, 1000)
leaseSweep.unref()

async function execute(request: ProjectIoRequest): Promise<unknown> {
  switch (request.op) {
    case 'openRead': {
      if (readLeases.size >= 256)
        throw Object.assign(new Error('read handle limit'), { code: 'LIMIT_EXCEEDED' })
      const token = randomUUID()
      // Reserve before opening: blocked opens count against the bound.
      const lease = {
        file: null as unknown as Awaited<ReturnType<typeof fs.open>>,
        fields: {} as StatsFields,
        deadline: Infinity,
        active: 1,
        closing: false,
      }
      readLeases.set(token, lease)
      try {
        lease.file = await fs.open(request.path, 'r')
        const stats = await lease.file.stat({ bigint: true })
        if (!stats.isFile())
          throw Object.assign(new Error('not a regular file'), { code: 'EINVAL' })
        lease.fields = Object.fromEntries(
          Object.entries(stats).map(([key, value]) => [
            key,
            typeof value === 'bigint' ? Number(value) : value,
          ]),
        ) as StatsFields
        lease.deadline = Date.now() + READ_LEASE_MS
        lease.active = 0
        return { readToken: token, fields: lease.fields, fileId: `${stats.dev}:${stats.ino}` }
      } catch (error) {
        try {
          await lease.file?.close()
        } finally {
          readLeases.delete(token)
        }
        throw error
      }
    }
    case 'readAt': {
      const lease = readLeases.get(request.readToken)
      if (!lease || lease.closing || lease.deadline <= Date.now())
        throw Object.assign(new Error('read handle expired'), { code: 'READ_HANDLE_EXPIRED' })
      if (
        !Number.isSafeInteger(request.offset) ||
        request.offset < 0 ||
        !Number.isSafeInteger(request.length) ||
        request.length < 1 ||
        request.length > 1024 * 1024 ||
        !Number.isSafeInteger(request.offset + request.length)
      )
        throw new RangeError('invalid read bounds')
      lease.active++
      lease.deadline = Date.now() + READ_LEASE_MS
      try {
        const bytes = Buffer.alloc(
          Math.min(request.length, Math.max(0, Number(lease.fields.size) - request.offset)),
        )
        const { bytesRead } = await lease.file.read(bytes, 0, bytes.length, request.offset)
        return bytes.subarray(0, bytesRead)
      } finally {
        lease.active--
        if (lease.closing && lease.active === 0) await closeLease(request.readToken)
      }
    }
    case 'closeRead':
      await closeLease(request.readToken)
      return null

    case 'readFile': {
      if (request.maxBytes !== undefined) {
        const file = await fs.open(request.path, request.flag ?? 'r')
        try {
          const chunks: Buffer[] = []
          let size = 0
          for (;;) {
            const chunk = Buffer.alloc(Math.min(1024 * 1024, request.maxBytes + 1 - size))
            const { bytesRead } = await file.read(chunk, 0, chunk.length, null)
            if (!bytesRead) break
            size += bytesRead
            if (size > request.maxBytes)
              throw Object.assign(new Error('project read exceeds configured body limit'), {
                code: 'LIMIT_EXCEEDED',
              })
            chunks.push(chunk.subarray(0, bytesRead))
          }
          return Buffer.concat(chunks, size)
        } finally {
          await file.close()
        }
      }
      return await fs.readFile(
        request.path,
        request.flag === undefined ? undefined : { flag: request.flag },
      )
    }
    case 'readRange': {
      const file = await fs.open(request.path, 'r')
      try {
        const stats = await file.stat()
        if (!stats.isFile())
          throw Object.assign(new Error('range target is not a regular file'), { code: 'EINVAL' })
        const bytes = Buffer.alloc(request.length)
        const result = await file.read(bytes, 0, bytes.length, request.offset)
        return { bytes: bytes.subarray(0, result.bytesRead), extent: stats.size }
      } finally {
        await file.close()
      }
    }
    case 'readdir': {
      if (request.maxBytes !== undefined) {
        const entries: Array<{ name: string; kind: DirEntryKind }> = []
        let bytes = 2
        const dir = await fs.opendir(request.path)
        for await (const entry of dir) {
          const item = { name: entry.name, kind: direntKindOf(entry) }
          bytes += Buffer.byteLength(JSON.stringify(item)) + (entries.length ? 1 : 0)
          if (bytes > request.maxBytes)
            throw Object.assign(new Error('listing exceeds maximum bytes'), {
              code: 'LIMIT_EXCEEDED',
            })
          entries.push(item)
        }
        return entries
      }
      const dirents = await fs.readdir(request.path, { withFileTypes: true })
      return dirents.map((entry) => ({ name: entry.name, kind: direntKindOf(entry) }))
    }
    case 'stat': {
      const options = request.bigint ? { bigint: true as const } : undefined
      const stats = request.follow
        ? await fs.stat(request.path, options as never)
        : await fs.lstat(request.path, options as never)
      // Own data properties only: the date accessors and type predicates are
      // rebuilt by the parent from these fields.
      return { ...(stats as unknown as StatsFields) }
    }
    case 'realpath':
      return await fs.realpath(request.path)
    case 'realpathNearest':
      return await realpathNearest(request.path)
    case 'access':
      await fs.access(request.path, request.mode)
      return null
    case 'mutate': {
      const run = (fs as unknown as Record<string, MutationRunner | undefined>)[request.method]
      if (MUTATION_METHODS[request.method] !== true || run === undefined) {
        const refusal = new Error(
          `unsupported project mutation '${request.method}'`,
        ) as NodeJS.ErrnoException
        refusal.code = 'EINVAL'
        throw refusal
      }
      // `mkdir` answers with the first created directory; every other method
      // answers with nothing.
      return (await run(...request.args)) ?? null
    }
    default:
      throw Object.assign(new Error('unsupported project operation'), { code: 'EINVAL' })
  }
}

/**
 * Answer the store. A closed channel means the store is gone (it exited, or
 * it replaced this worker), so the worker leaves quietly instead of raising an
 * unhandled write error.
 */
function respond(response: ProjectIoResponse): void {
  if (process.send === undefined || !process.connected) {
    process.exit(0)
  }
  try {
    process.send(response, undefined, undefined, () => undefined)
  } catch {
    process.exit(0)
  }
}

process.on('message', (raw: unknown) => {
  const request = raw as ProjectIoRequest
  if (typeof request?.id !== 'number') return
  execute(request).then(
    (value) => respond({ kind: 'result', id: request.id, value }),
    (error: unknown) => {
      const err = error as NodeJS.ErrnoException & { dest?: string }
      const serialized: SerializedErrno = {
        message: typeof err?.message === 'string' ? err.message : String(error),
      }
      if (typeof err?.code === 'string') serialized.code = err.code
      if (typeof err?.errno === 'number') serialized.errno = err.errno
      if (typeof err?.syscall === 'string') serialized.syscall = err.syscall
      if (typeof err?.path === 'string') serialized.path = err.path
      if (typeof err?.dest === 'string') serialized.dest = err.dest
      respond({ kind: 'error', id: request.id, error: serialized })
    },
  )
})

// The worker outlives no parent: a lost channel means the store is gone.
process.on('disconnect', () => process.exit(0))

respond({ kind: 'ready' })
