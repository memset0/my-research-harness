import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __testAssertOwnerOnlyServiceConfigForUid,
  assertOwnerOnlyServiceConfig,
  SERVICE_CONFIG_FILE_MODE,
} from './permissions.js'

let directory: string
let configPath: string

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'memon-service-config-'))
  configPath = join(directory, 'instance.yml')
  await fs.chmod(directory, 0o700)
  await fs.writeFile(configPath, 'central: { hosts: [] }\n', {
    mode: SERVICE_CONFIG_FILE_MODE,
  })
  await fs.chmod(configPath, SERVICE_CONFIG_FILE_MODE)
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe.runIf(process.platform !== 'win32')('assertOwnerOnlyServiceConfig', () => {
  it('accepts a current-user regular file at 0600 in an owner-only directory', async () => {
    await expect(assertOwnerOnlyServiceConfig(configPath)).resolves.toBeUndefined()
  })

  it.each([0o640, 0o660, 0o400])('rejects config mode %s', async (mode) => {
    await fs.chmod(configPath, mode)
    await expect(assertOwnerOnlyServiceConfig(configPath)).rejects.toThrow(/mode must be 0600/)
  })

  it('rejects a group/world-accessible parent directory', async () => {
    await fs.chmod(directory, 0o755)
    await expect(assertOwnerOnlyServiceConfig(configPath)).rejects.toThrow(
      /parent must be owner-only/,
    )
  })

  it('rejects a symlink even when its target is a protected regular file', async () => {
    const link = join(directory, 'instance-link.yml')
    await fs.symlink(configPath, link)
    await expect(assertOwnerOnlyServiceConfig(link)).rejects.toThrow(/regular non-symlink file/)
  })

  it('rejects a non-regular config path', async () => {
    await expect(assertOwnerOnlyServiceConfig(directory)).rejects.toThrow(
      /regular non-symlink file/,
    )
  })

  it('rejects ownership that does not match the running user', async () => {
    const ownerUid = (await fs.lstat(configPath)).uid
    await expect(
      __testAssertOwnerOnlyServiceConfigForUid(configPath, ownerUid + 1),
    ).rejects.toThrow(/owned by the current user/)
  })
})
