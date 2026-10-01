import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveRuntimeConfigPath } from './runtime-config-path'

let workspace: string
let nestedCwd: string

beforeEach(async () => {
  workspace = await fs.mkdtemp(join(tmpdir(), 'memon-runtime-config-path-'))
  nestedCwd = join(workspace, 'apps', 'web')
  await fs.mkdir(nestedCwd, { recursive: true })
  await fs.writeFile(join(workspace, 'pnpm-workspace.yaml'), 'packages: []\n')
})

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true })
})

describe('resolveRuntimeConfigPath', () => {
  it('walks to the workspace and selects config.yml only', async () => {
    const instancePath = join(workspace, 'config.yml')
    const examplePath = join(workspace, 'config.example.yml')
    await fs.writeFile(instancePath, 'projects: []\n')
    await fs.writeFile(examplePath, 'template: keep\n')

    await expect(resolveRuntimeConfigPath({ cwd: nestedCwd })).resolves.toBe(instancePath)
    await expect(fs.readFile(examplePath, 'utf8')).resolves.toBe('template: keep\n')
  })

  it('returns null when the workspace contains only config.example.yml', async () => {
    const examplePath = join(workspace, 'config.example.yml')
    await fs.writeFile(examplePath, 'template: keep\n')
    const before = await fs.stat(examplePath)

    await expect(resolveRuntimeConfigPath({ cwd: nestedCwd })).resolves.toBeNull()

    const after = await fs.stat(examplePath)
    await expect(fs.readFile(examplePath, 'utf8')).resolves.toBe('template: keep\n')
    expect(after.mtimeMs).toBe(before.mtimeMs)
    const workspaceEntries = await fs.readdir(workspace)
    expect(workspaceEntries.sort()).toEqual(['apps', 'config.example.yml', 'pnpm-workspace.yaml'])
  })

  it('returns null when no workspace instance configuration exists', async () => {
    await expect(resolveRuntimeConfigPath({ cwd: nestedCwd })).resolves.toBeNull()
  })

  it('rejects an explicitly selected config.example.yml before reading it', async () => {
    const examplePath = join(workspace, 'config.example.yml')
    await fs.writeFile(examplePath, 'template: keep\n')
    const before = await fs.stat(examplePath)

    await expect(
      resolveRuntimeConfigPath({ cwd: nestedCwd, explicitPath: '../../config.example.yml' }),
    ).rejects.toThrow(/protected template.*copy.*config\.yml/i)

    const after = await fs.stat(examplePath)
    await expect(fs.readFile(examplePath, 'utf8')).resolves.toBe('template: keep\n')
    expect(after.mtimeMs).toBe(before.mtimeMs)
  })

  it('preserves an explicitly selected custom instance path', async () => {
    const explicitPath = '../../instances/cluster.yml'
    await expect(resolveRuntimeConfigPath({ cwd: nestedCwd, explicitPath })).resolves.toBe(
      resolve(nestedCwd, explicitPath),
    )
  })
})
