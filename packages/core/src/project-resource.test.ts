import { promises as fs } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ProjectResourceError, resolveProjectResource } from './project-resource.js'

let directory: string
let root: string
let outside: string

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'memon-project-resource-'))
  root = join(directory, 'project')
  outside = join(directory, 'outside')
  await fs.mkdir(join(root, 'logs'), { recursive: true })
  await fs.mkdir(outside)
  await fs.writeFile(join(root, 'logs', 'run.log'), 'inside')
  await fs.writeFile(join(outside, 'secret.txt'), 'outside')
})

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true })
})

describe('resolveProjectResource', () => {
  it('resolves an existing portable resource beneath the real Project root', async () => {
    const result = await resolveProjectResource(root, 'logs/run.log')
    expect(result.exists).toBe(true)
    expect(result.path).toBe(await fs.realpath(join(root, 'logs', 'run.log')))
    expect(result.realRoot).toBe(await fs.realpath(root))
  })

  it.each([
    '/etc/passwd',
    '../secret',
    'logs/../secret',
    'logs\\run.log',
    'logs%2frun.log',
    'logs%252frun.log',
    'C:\\Windows\\system.ini',
    `bad\0id`,
  ])('rejects unsafe wire identifier %s', async (resourceId) => {
    await expect(resolveProjectResource(root, resourceId)).rejects.toMatchObject({
      code: 'INVALID_RESOURCE',
    })
  })

  it('rejects a final symlink that escapes the Project', async () => {
    await fs.symlink(join(outside, 'secret.txt'), join(root, 'logs', 'escape.txt'))
    await expect(resolveProjectResource(root, 'logs/escape.txt')).rejects.toMatchObject({
      code: 'OUTSIDE_PROJECT',
    })
  })

  it('rejects an existing parent symlink during create resolution', async () => {
    await fs.symlink(outside, join(root, 'linked'))
    await expect(
      resolveProjectResource(root, 'linked/new.txt', { forCreate: true }),
    ).rejects.toMatchObject({ code: 'OUTSIDE_PROJECT' })
  })

  it('rejects a device-like Unix socket inside the Project', async () => {
    if (process.platform === 'win32') return
    const socketPath = join(root, 'logs', 'runtime.sock')
    const server = createServer()
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(socketPath, resolve)
    })
    try {
      await expect(resolveProjectResource(root, 'logs/runtime.sock')).rejects.toMatchObject({
        code: 'UNSUPPORTED_RESOURCE',
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('allows a missing nested create target under the nearest real parent', async () => {
    const result = await resolveProjectResource(root, 'logs/new/deep.txt', { forCreate: true })
    expect(result.exists).toBe(false)
    expect(result.path).toBe(join(await fs.realpath(root), 'logs', 'new', 'deep.txt'))
  })

  it('rejects a missing target unless creation was requested', async () => {
    await expect(resolveProjectResource(root, 'logs/missing.txt')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
  })

  it('rejects a configured root that is not a directory', async () => {
    const fileRoot = join(directory, 'file-root')
    await fs.writeFile(fileRoot, 'x')
    await expect(resolveProjectResource(fileRoot, 'child')).rejects.toBeInstanceOf(
      ProjectResourceError,
    )
    await expect(resolveProjectResource(fileRoot, 'child')).rejects.toMatchObject({
      code: 'NOT_A_DIRECTORY',
    })
  })
})
