import { AsyncLocalStorage } from 'node:async_hooks'
import { rmdirSync } from 'node:fs'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { isFileURI } from '@memon/file-protocol/paths'
import { getProjectFileContext } from './project-file-context.js'
import { projectFs } from './project-file-store/fs-facade.js'

export const FILE_WRITER_LOCK_PATH = '.memon/locks/write-v1'
const HELD = Symbol.for('memon.file-writer-lock.v1')
const carrier = globalThis as unknown as { [HELD]?: AsyncLocalStorage<ReadonlySet<string>> }
carrier[HELD] ??= new AsyncLocalStorage<ReadonlySet<string>>()
const held = carrier[HELD]
export interface FileWriterLock {
  release(): void
}

/** Same mkdir-based source lock as protocol-v1; an abandoned lock is never stolen. */
export async function acquireFileWriterLock(
  root: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<FileWriterLock> {
  if (isFileURI(root)) throw new Error('logical authorities acquire writer locks at the source')
  const canonical = await realpath(root)
  const directory = join(canonical, '.memon', 'locks')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, '.gitignore'), '*\n', { flag: 'wx' }).catch((error) => {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  })
  const path = join(canonical, FILE_WRITER_LOCK_PATH)
  const deadline = performance.now() + (options.timeoutMs ?? 30_000)
  for (;;) {
    options.signal?.throwIfAborted()
    try {
      await mkdir(path, { mode: 0o700 })
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (performance.now() >= deadline)
      throw Object.assign(
        new Error('project writer lock is busy; abandoned locks require operator recovery'),
        { code: 'EBUSY' },
      )
    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
  let released = false
  return {
    release() {
      if (!released) {
        rmdirSync(path)
        released = true
      }
    },
  }
}

export async function withFileWriterLock<T>(root: string, work: () => Promise<T>): Promise<T> {
  if (isFileURI(root)) return work()
  const context = getProjectFileContext()
  const canonical = await (context ? projectFs.realpath(root) : realpath(root))
  if (held.getStore()?.has(canonical)) return work()
  if (context) {
    const directory = join(root, '.memon', 'locks')
    await projectFs.mkdir(directory, { recursive: true })
    await projectFs
      .writeFile(join(directory, '.gitignore'), '*\n', { flag: 'wx' })
      .catch((error) => {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      })
    const path = join(root, FILE_WRITER_LOCK_PATH),
      deadline = performance.now() + 30_000
    for (;;) {
      try {
        await projectFs.mkdir(path, { mode: 0o700 })
        break
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      if (performance.now() >= deadline)
        throw Object.assign(
          new Error('project writer lock is busy; abandoned locks require operator recovery'),
          { code: 'EBUSY' },
        )
      await new Promise<void>((done) => setTimeout(done, 50))
    }
    const scope = new Set(held.getStore())
    scope.add(canonical)
    try {
      return await held.run(scope, work)
    } finally {
      await projectFs.rmdir(path)
    }
  }
  const lock = await acquireFileWriterLock(canonical)
  const scope = new Set(held.getStore())
  scope.add(canonical)
  try {
    return await held.run(scope, work)
  } finally {
    lock.release()
  }
}
