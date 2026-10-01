// project-file-store/containment — lexical target resolution and symlink-aware containment.

import type { PathLike } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isWithinPath } from '../mount-table.js'
import { containmentError } from './errors.js'

export function resolveTargetPath(target: PathLike): string | null {
  if (typeof target === 'string') return resolve(target)
  if (Buffer.isBuffer(target)) return resolve(target.toString('utf8'))
  if (target instanceof URL) {
    if (target.protocol !== 'file:') return null
    return resolve(fileURLToPath(target))
  }
  return null
}

/**
 * Symlink-aware containment. `keepFinalLink` leaves the last component
 * unresolved (for `lstat`, which must observe the link itself) while still
 * requiring its parent chain to stay inside the root.
 *
 * `resolveReal` performs the physical resolution (the deepest existing
 * ancestor, remainder kept lexically) in the storage group's isolated worker;
 * the decision itself stays here.
 */
export async function containedRealPath(
  rootReal: string,
  target: string,
  syscall: string,
  keepFinalLink: boolean,
  resolveReal: (path: string) => Promise<string>,
): Promise<string> {
  const anchor = keepFinalLink ? dirname(target) : target
  const resolved = await resolveReal(anchor)
  const full = keepFinalLink ? join(resolved, basename(target)) : resolved
  if (!isWithinPath(rootReal, resolved) || !isWithinPath(rootReal, full)) {
    throw containmentError(syscall, target, rootReal)
  }
  return full
}
