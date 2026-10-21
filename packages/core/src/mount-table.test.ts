// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  containingMount,
  NETWORK_FS_TYPES,
  parseDarwinMountOutput,
  readMountTable,
} from './mount-table.js'

const DARWIN_OUTPUT = [
  '/dev/disk1s4s1 on / (apfs, sealed, local, read-only, journaled)',
  'devfs on /dev (devfs, local, nobrowse)',
  '/dev/disk1s1 on /System/Volumes/Data (apfs, local, journaled, nobrowse, root data)',
  'map auto_home on /System/Volumes/Data/home (autofs, automounted, nobrowse)',
  '//user@nas.example.test/share on /Volumes/share (smbfs, nodev, nosuid, mounted by user)',
  'nas.example.test:/export on /Volumes/export (nfs, nodev, nosuid, mounted by user)',
  'user@host-a:/data on /Volumes/remote data (macfuse, nodev, nosuid, synchronous, mounted by user)',
  '/dev/disk4s1 on /Volumes/My Disk (on loan) (apfs, local, nodev, nosuid, journaled)',
  'not a mount line',
  '',
].join('\n')

describe('parseDarwinMountOutput', () => {
  const table = parseDarwinMountOutput(DARWIN_OUTPUT)

  it('keeps source, mount point and filesystem type of every mount line', () => {
    expect(table).toHaveLength(8)
    expect(table[0]).toEqual({ mountPoint: '/', fsType: 'apfs', source: '/dev/disk1s4s1' })
    expect(table[3]).toEqual({
      mountPoint: '/System/Volumes/Data/home',
      fsType: 'autofs',
      source: 'map auto_home',
    })
  })

  it('keeps spaces and parentheses inside mount points', () => {
    expect(table.map((entry) => entry.mountPoint)).toContain('/Volumes/remote data')
    expect(table.map((entry) => entry.mountPoint)).toContain('/Volumes/My Disk (on loan)')
  })

  it('classifies macOS network mounts and keeps local volumes local', () => {
    const network = (path: string) => {
      const mount = containingMount(path, table)
      return mount !== undefined && NETWORK_FS_TYPES[mount.fsType] === true
    }
    expect(network('/Volumes/share/cache/dump')).toBe(true)
    expect(network('/Volumes/export/dump')).toBe(true)
    expect(network('/Volumes/remote data/dump')).toBe(true)
    expect(network('/Users/someone/.local/share/memon/cache/dump')).toBe(false)
    expect(network('/Volumes/My Disk (on loan)/dump')).toBe(false)
    for (const type of ['afpfs', 'webdav', 'macfuse', 'osxfuse', 'nfs', 'smbfs']) {
      expect(NETWORK_FS_TYPES[type]).toBe(true)
    }
  })
})

describe.runIf(process.platform === 'darwin')('readMountTable on macOS', () => {
  it('returns the host mount table with a local root volume', async () => {
    const table = await readMountTable()
    expect(table).not.toBeNull()
    const root = containingMount('/', table ?? [])
    expect(root?.mountPoint).toBe('/')
    expect(NETWORK_FS_TYPES[root?.fsType ?? '']).toBeUndefined()
  })
})
