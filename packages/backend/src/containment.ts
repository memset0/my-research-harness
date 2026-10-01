// The one Project path-containment rule for every Backend service.
//
// `isContained` is the pure lexical rule. `resolveContained` applies it twice:
// to the lexical path (so `..` never leaves the root) and to the real paths of
// both root and target through the Project file facade (so a symlink cannot
// leave it either). Services translate `PathContainmentError` into their own
// INVALID_RESOURCE error.

import { isAbsolute, relative, resolve, sep } from 'node:path'
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
}

/**
 * Resolve `relPath` (relative to `projectRoot`, or absolute) to its real path
 * and require it to stay inside the real Project root. Throws
 * `PathContainmentError` on escape; a missing target throws its `ENOENT` /
 * `ENOTDIR`, or yields `null` with `allowMissing`. Other filesystem failures
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
