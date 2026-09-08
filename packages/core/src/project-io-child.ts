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
//   * It holds NO state: no cache, no queue, no policy. Every path arriving
//     here was already contained and authorized by the parent, and every
//     result is answered as plain data. Adding a cache here would create a
//     second, unaccounted copy of the project.

import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  DirEntryData,
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

async function execute(request: ProjectIoRequest): Promise<unknown> {
  switch (request.op) {
    case 'readFile':
      return await fs.readFile(
        request.path,
        request.flag === undefined ? undefined : { flag: request.flag },
      )
    case 'readdir': {
      const dirents = await fs.readdir(request.path, { withFileTypes: true })
      const entries: DirEntryData[] = []
      for (const entry of dirents) {
        let kind: DirEntryKind = 'other'
        if (entry.isSymbolicLink()) kind = 'symlink'
        else if (entry.isDirectory()) kind = 'directory'
        else if (entry.isFile()) kind = 'file'
        entries.push({ name: entry.name, kind })
      }
      return entries
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
