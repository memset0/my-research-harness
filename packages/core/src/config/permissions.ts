import { promises as fs } from 'node:fs'
import { dirname, resolve } from '@memon/file-protocol/paths'

export const SERVICE_CONFIG_FILE_MODE = 0o600

function octalMode(mode: number): string {
  return `0${(mode & 0o7777).toString(8).padStart(3, '0')}`
}

/**
 * Enforce the POSIX trust boundary for central/Backend instance files that
 * carry service tokens. Ordinary standalone configs intentionally do not call
 * this helper and retain their existing permissions policy.
 */
async function assertOwnerOnlyServiceConfigForUid(
  configPath: string,
  currentUid: number,
): Promise<void> {
  const resolvedPath = resolve(configPath)
  const parentPath = dirname(resolvedPath)
  const [file, parent] = await Promise.all([fs.lstat(resolvedPath), fs.lstat(parentPath)])

  if (file.isSymbolicLink() || !file.isFile()) {
    throw new Error('service-token config must be a regular non-symlink file')
  }
  if (file.uid !== currentUid) {
    throw new Error('service-token config must be owned by the current user')
  }
  if ((file.mode & 0o7777) !== SERVICE_CONFIG_FILE_MODE) {
    throw new Error(`service-token config mode must be 0600 (found ${octalMode(file.mode)})`)
  }

  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error('service-token config parent must be a real directory')
  }
  if (parent.uid !== currentUid) {
    throw new Error('service-token config parent must be owned by the current user')
  }
  if ((parent.mode & 0o077) !== 0) {
    throw new Error(
      `service-token config parent must be owner-only (found ${octalMode(parent.mode)})`,
    )
  }
}

export async function assertOwnerOnlyServiceConfig(configPath: string): Promise<void> {
  if (process.platform === 'win32') return
  const currentUid = process.getuid?.()
  if (currentUid === undefined) {
    throw new Error('cannot verify service-token config ownership on this platform')
  }
  await assertOwnerOnlyServiceConfigForUid(configPath, currentUid)
}

/** Test-only ownership seam; production callers use the current process uid. */
export const __testAssertOwnerOnlyServiceConfigForUid = assertOwnerOnlyServiceConfigForUid
