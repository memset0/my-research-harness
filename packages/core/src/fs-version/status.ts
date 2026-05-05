import type { FsVersionStatus } from './types.js'

/**
 * Compare a project's recorded version (`current`, or `null` if uninitialised)
 * against the bundled tool version (`available`) and yield the status enum.
 */
export function computeFsVersionStatus(current: number | null, available: number): FsVersionStatus {
  if (current === null) return 'uninitialised'
  if (current === available) return 'match'
  if (current < available) return 'behind'
  return 'ahead'
}
