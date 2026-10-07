import { isFileAccessError } from '@memon/file-protocol'
import { getProjectFileContext } from '../project-file-context.js'

// project-file-store/errors — errno-shaped refusals raised by the Project file store.

export function readOnlyError(syscall: string, path: string): NodeJS.ErrnoException {
  const error = new Error(
    `EROFS: read-only project file access, ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EROFS'
  error.errno = -30
  error.syscall = syscall
  error.path = path
  return error
}

/**
 * Refusal for a path outside its project file context root, including through
 * a symlink. This is an access error, never a "missing" observation. A request
 * that legitimately spans several projects must open one context per root.
 */
export function containmentError(
  syscall: string,
  path: string,
  root: string,
): NodeJS.ErrnoException {
  const error = new Error(
    `EACCES: path escapes the project file context root '${root}', ${syscall} '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EACCES'
  error.errno = -13
  error.syscall = syscall
  error.path = path
  return error
}

/** Refusal when a storage group already has the maximum pending operations. */
export function queueFullError(path: string): NodeJS.ErrnoException {
  const error = new Error(
    `EBUSY: project file operation queue is full, read '${path}'`,
  ) as NodeJS.ErrnoException
  error.code = 'EBUSY'
  error.errno = -16
  error.syscall = 'read'
  error.path = path
  return error
}

/**
 * Refusal when the storage behind a project root is gone or was replaced. A
 * vanished SSHFS mountpoint frequently reverts to an ordinary empty local
 * directory, and publishing that as an empty project would look like every
 * file was deleted.
 */
export function mountUnavailableError(syscall: string, root: string): NodeJS.ErrnoException {
  const error = new Error(
    `ENXIO: project storage mount is unavailable or was replaced, ${syscall} '${root}'`,
  ) as NodeJS.ErrnoException
  error.code = 'ENXIO'
  error.errno = -6
  error.syscall = syscall
  error.path = root
  return error
}

/** Lenient CLI discovery must not turn central source failures into missing data. */
export function throwIfSourceFailure(error: unknown): void {
  if (isFileAccessError(error)) throw error
  const code = (error as NodeJS.ErrnoException | null)?.code
  if (getProjectFileContext() && typeof code === 'string' && !['ENOENT', 'ENOTDIR'].includes(code))
    throw error
}
