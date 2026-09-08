// mount-table — the OS-local mount table, shared by the project file store's
// availability guard and the persistent cache's storage decisions.
//
// Every read here is local (`/proc/self/mountinfo`): it never touches the
// remote storage it describes, which is exactly why it can be consulted while
// a mount is hung.

import { promises as nodeFs } from 'node:fs'
import { sep } from 'node:path'

/** One line of the OS mount table, reduced to the fields we compare. */
export interface MountIdentity {
  mountPoint: string
  fsType: string
  source: string
}

/** The filesystem type of an SSHFS mount, the only persistable storage. */
export const SSHFS_FS_TYPE = 'fuse.sshfs'

/**
 * Mount identity comparison: the same storage remounted still matches, while
 * an unmounted or replaced mount point does not. Kernel mount ids are
 * deliberately ignored.
 */
export function sameMountIdentity(left: MountIdentity, right: MountIdentity): boolean {
  return (
    left.mountPoint === right.mountPoint &&
    left.fsType === right.fsType &&
    left.source === right.source
  )
}

/**
 * Filesystem types whose latency and availability depend on a network peer.
 * The persistent cache dump must never live on one: it exists to answer while
 * such a peer is slow or gone.
 */
export const NETWORK_FS_TYPES: Record<string, true> = {
  '9p': true,
  afs: true,
  ceph: true,
  cifs: true,
  'fuse.davfs': true,
  'fuse.rclone': true,
  'fuse.s3fs': true,
  'fuse.sshfs': true,
  fuseblk: true,
  glusterfs: true,
  lustre: true,
  ncpfs: true,
  nfs: true,
  nfs4: true,
  smb2: true,
  smb3: true,
  smbfs: true,
  sshfs: true,
}

export function isWithinPath(root: string, absolutePath: string): boolean {
  if (absolutePath === root) return true
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`
  return absolutePath.startsWith(prefix)
}

/** `/proc/self/mountinfo` escapes whitespace and backslashes octally. */
function unescapeMountField(field: string): string {
  return field
    .replace(/\\040/g, ' ')
    .replace(/\\011/g, '\t')
    .replace(/\\012/g, '\n')
    .replace(/\\134/g, '\\')
}

/**
 * Read the local mount table. Returns null when the platform has no
 * `/proc/self/mountinfo`, which disables mount-identity decisions rather than
 * guessing from a path shape.
 */
export async function readMountTable(): Promise<MountIdentity[] | null> {
  let raw: string
  try {
    raw = await nodeFs.readFile('/proc/self/mountinfo', 'utf8')
  } catch {
    return null
  }
  const entries: MountIdentity[] = []
  for (const line of raw.split('\n')) {
    if (line.length === 0) continue
    const separator = line.indexOf(' - ')
    if (separator < 0) continue
    const left = line.slice(0, separator).split(' ')
    const right = line.slice(separator + 3).split(' ')
    const mountPoint = left[4]
    const fsType = right[0]
    const source = right[1]
    if (mountPoint === undefined || fsType === undefined || source === undefined) continue
    entries.push({
      mountPoint: unescapeMountField(mountPoint),
      fsType,
      source: unescapeMountField(source),
    })
  }
  return entries
}

/** The most specific mount containing `path`. */
export function containingMount(
  path: string,
  entries: MountIdentity[],
): MountIdentity | undefined {
  let best: MountIdentity | undefined
  for (const entry of entries) {
    if (!isWithinPath(entry.mountPoint, path)) continue
    if (best === undefined || entry.mountPoint.length > best.mountPoint.length) best = entry
  }
  return best
}
