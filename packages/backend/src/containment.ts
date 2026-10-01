// The one Project path-containment rule for every Backend service.
//
// `isContained` is the pure lexical rule. `resolveContained` applies it twice:
// to the lexical path (so `..` never leaves the root) and to the real paths of
// both root and target through the Project file facade (so a symlink cannot
// leave it either). Services translate `PathContainmentError` into their own
// INVALID_RESOURCE error.

import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { projectFs as fs } from '@memon/core'

export class PathContainmentError extends Error {
  constructor(message = 'Path escapes the Project root') {
    super(message)
    this.name = 'PathContainmentError'
  }
}

/** True when `target` is `root` itself or lies beneath it (both absolute). */
export function isContained(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || !(rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
}

export interface ResolveContainedOptions {
  /** Return `null` instead of throwing when the target (or a parent) does not exist. */
  allowMissing?: boolean
  /**
   * Skip the lexical check and judge only the real path. For configured
   * paths (Git mappings, submodules) that may reach into the Project through
   * a link from outside it.
   */
  realPathOnly?: boolean
  /**
   * `false`: the target, its parents and even the Project root may be absent.
   * Each is resolved through the real path of its nearest existing ancestor
   * with the missing segments re-appended, containment is judged on those
   * paths, and the would-be real path is returned. For Git paths that may
   * exist only in the index or a commit (deleted, not yet created).
   */
  mustExist?: boolean
}

/**
 * Resolve `relPath` (relative to `projectRoot`, or absolute) to its real path
 * and require it to stay inside the real Project root. Throws
 * `PathContainmentError` on escape; a missing target throws its `ENOENT` /
 * `ENOTDIR`, or yields `null` with `allowMissing`; with `mustExist: false`
 * absence is never an error (see the option). Other filesystem failures
 * always propagate.
 */
export async function resolveContained(
  projectRoot: string,
  relPath: string,
  options: ResolveContainedOptions & { allowMissing: true },
): Promise<string | null>
export async function resolveContained(
  projectRoot: string,
  relPath: string,
  options?: ResolveContainedOptions,
): Promise<string>
export async function resolveContained(
  projectRoot: string,
  relPath: string,
  options: ResolveContainedOptions = {},
): Promise<string | null> {
  const lexicalRoot = resolve(projectRoot)
  const lexicalTarget = resolve(lexicalRoot, relPath)
  if (!options.realPathOnly && !isContained(lexicalRoot, lexicalTarget)) {
    throw new PathContainmentError()
  }
  if (options.mustExist === false) {
    const [root, target] = await Promise.all([
      realpathNearest(lexicalRoot),
      realpathNearest(lexicalTarget),
    ])
    if (!isContained(root, target)) throw new PathContainmentError()
    return target
  }
  const [root, target] = await Promise.allSettled([
    fs.realpath(lexicalRoot),
    fs.realpath(lexicalTarget),
  ])
  // An unreadable Project root is never "missing": it always propagates.
  if (root.status === 'rejected') throw root.reason
  if (target.status === 'rejected') {
    const code = (target.reason as NodeJS.ErrnoException).code
    if (options.allowMissing && (code === 'ENOENT' || code === 'ENOTDIR')) return null
    throw target.reason
  }
  if (!isContained(root.value, target.value)) throw new PathContainmentError()
  return target.value
}

function isAbsence(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ENOENT' || code === 'ENOTDIR'
}

/**
 * Real path of `path` when it exists; otherwise the real path of its deepest
 * existing ancestor joined with the missing tail. Only absence (`ENOENT` /
 * `ENOTDIR`) walks up; every other failure propagates.
 */
async function realpathNearest(path: string): Promise<string> {
  const missing: string[] = []
  let current = path
  for (;;) {
    try {
      const real = await fs.realpath(current)
      return missing.length === 0 ? real : join(real, ...missing.reverse())
    } catch (error) {
      if (!isAbsence(error)) throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}
