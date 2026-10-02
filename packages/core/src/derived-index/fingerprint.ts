// Persisted file fingerprints.
//
// `{ ino, size, mtime_ms, ctime_ms }` or `null` for an absent file. The device
// number is deliberately left out: it differs between NFS client mounts of
// the same export, so a fingerprint taken on one node must still match on
// another. Paths are the keys, so a false match needs inode reuse with
// identical size and times.

import { defaultIndexFs, errnoCode, type IndexFs } from './fs.js'

export interface PersistedFingerprint {
  ino: number
  size: number
  mtime_ms: number
  ctime_ms: number
}

export interface FingerprintSource {
  ino: number | bigint
  size: number | bigint
  mtimeMs: number | bigint
  ctimeMs: number | bigint
}

/** The persisted fingerprint of a stat result. */
export function persistedFingerprint(stat: FingerprintSource): PersistedFingerprint {
  return {
    ino: Number(stat.ino),
    size: Number(stat.size),
    mtime_ms: Number(stat.mtimeMs),
    ctime_ms: Number(stat.ctimeMs),
  }
}

/** Stat `path` and return its fingerprint; `null` when it does not exist. */
export async function takeFingerprint(
  path: string,
  fs: IndexFs = defaultIndexFs,
): Promise<PersistedFingerprint | null> {
  try {
    return persistedFingerprint(await fs.stat(path))
  } catch (error) {
    const code = errnoCode(error)
    if (code === 'ENOENT' || code === 'ENOTDIR') return null
    throw error
  }
}

/** Field-wise equality; two absent fingerprints are equal. */
export function sameFingerprint(
  left: PersistedFingerprint | null | undefined,
  right: PersistedFingerprint | null | undefined,
): boolean {
  if (!left || !right) return (left ?? null) === (right ?? null)
  return (
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtime_ms === right.mtime_ms &&
    left.ctime_ms === right.ctime_ms
  )
}

/** The newest change time among fingerprints (`-Infinity` when none). */
export function newestCtime(
  ...fingerprints: Array<PersistedFingerprint | null | undefined>
): number {
  let newest = Number.NEGATIVE_INFINITY
  for (const fingerprint of fingerprints) {
    if (fingerprint && fingerprint.ctime_ms > newest) newest = fingerprint.ctime_ms
  }
  return newest
}
