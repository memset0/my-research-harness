// project-file-store/mount-guard — the real path of each project root and
// the mount-identity guard that refuses I/O once a root's storage is gone or
// replaced. Every read here is OS-local (`/proc/self/mountinfo`) or a single
// root resolution in the storage group's isolated worker.

import {
  containingMount,
  type MountIdentity,
  readMountTable,
  sameMountIdentity,
} from '../mount-table.js'
import { getProjectIo } from '../project-io.js'
import { monotonic } from './clock.js'
import { mountUnavailableError } from './errors.js'

/** Mount-table snapshot lifetime; the read is OS-local, never remote. */
const MOUNT_TABLE_TTL_MS = 1_000

export class MountGuard {
  /** Resolved real path of each project root, observed once per process. */
  private readonly realRoots = new Map<string, string>()
  /** Mount identity observed for each real root, used as an availability guard. */
  private readonly rootMounts = new Map<string, MountIdentity>()
  private mountTableEntries: MountIdentity[] | null = null
  private mountTableAtMono: number | null = null
  private mountTableRead: Promise<MountIdentity[] | null> | null = null

  /**
   * Real path of a project root, observed once per process, in the storage
   * group's isolated worker. Roots are stable mounts; resolving them per read
   * would add metadata I/O to every operation. A genuinely missing root is NOT
   * cached (it may come back) and keeps the lexical path so ordinary missing
   * states still work; an access/transport error propagates instead of being
   * frozen into a lexical fallback.
   */
  async realRoot(root: string, group: string): Promise<string> {
    const cached = this.realRoots.get(root)
    if (cached !== undefined) return cached
    try {
      const real = await getProjectIo().realpath(group, root)
      this.realRoots.set(root, real)
      return real
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return root
      throw error
    }
  }

  /**
   * Mount-identity guard for the storage behind a root.
   *
   * When an SSHFS mount disappears its mountpoint often reverts to an
   * ordinary empty local directory, which would otherwise be published as a
   * project whose files were all deleted. The guard remembers the mountpoint,
   * filesystem type and source observed for a root and refuses project I/O
   * once that identity is gone or replaced. A remount with the same
   * source/type is accepted (the kernel mount id intentionally is not
   * compared). The table comes from the OS-local `/proc/self/mountinfo` with a
   * short TTL, so there is no per-file remote metadata traffic; on a platform
   * without that file the guard is inert.
   */
  async assertMountIdentity(rootReal: string, syscall: string): Promise<void> {
    const table = await this.mountTable()
    if (table === null) return
    const known = this.rootMounts.get(rootReal)
    if (known === undefined) {
      const observed = containingMount(rootReal, table)
      if (observed !== undefined) this.rootMounts.set(rootReal, observed)
      return
    }
    // Identity is the (mountpoint, type, source) tuple: a remount of the same
    // storage still matches (kernel mount ids are deliberately ignored), while
    // an unmounted or replaced mountpoint no longer appears at all.
    const alive = table.some((entry) => sameMountIdentity(entry, known))
    if (!alive) throw mountUnavailableError(syscall, rootReal)
    // A newly added mount at or under the root (storage mounted after the
    // first observation) becomes the identity to watch from now on.
    const current = containingMount(rootReal, table)
    if (current !== undefined && current.mountPoint.length > known.mountPoint.length) {
      this.rootMounts.set(rootReal, current)
    }
  }

  /** `/proc/self/mountinfo` snapshot, shared and refreshed on a short TTL. */
  async mountTable(): Promise<MountIdentity[] | null> {
    const now = monotonic()
    if (this.mountTableAtMono !== null && now - this.mountTableAtMono < MOUNT_TABLE_TTL_MS) {
      return this.mountTableEntries
    }
    if (this.mountTableRead === null) {
      this.mountTableRead = readMountTable().then((entries) => {
        this.mountTableEntries = entries
        this.mountTableAtMono = monotonic()
        this.mountTableRead = null
        return entries
      })
    }
    return await this.mountTableRead
  }
}
