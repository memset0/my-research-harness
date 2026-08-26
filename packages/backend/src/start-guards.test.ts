import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BackendStartGuards } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { preflightBackendStart as publicPreflightBackendStart } from './index.js'
import {
  assertRuntimeDirectoryPolicy,
  type BackendStartPreflightInput,
  evaluateBackendStartGuards,
  preflightBackendStart,
  preflightRuntimeDirectory,
} from './start-guards.js'

const SAFE_GUARDS: BackendStartGuards = {
  allowedHostnamePatterns: ['login-??.example.test', 'management-*'],
  forbiddenEnvironment: ['SLURM_JOB_ID', 'PBS_JOBID'],
}

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-start-guards-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

function input(overrides: Partial<BackendStartPreflightInput> = {}): BackendStartPreflightInput {
  return {
    guards: SAFE_GUARDS,
    hostname: 'login-01.example.test',
    environment: {},
    runtimeDir: join(dir, 'node-local', 'run'),
    runtimePolicy: {
      stateDir: join(dir, 'persistent', 'state'),
      releaseDir: join(dir, 'persistent', 'releases'),
      forbiddenSharedRoots: [join(dir, 'shared-home'), join(dir, 'project-a')],
    },
    ...overrides,
  }
}

async function attemptStart(
  startInput: BackendStartPreflightInput,
  seams: { mkdir: () => unknown | Promise<unknown>; spawn: () => unknown | Promise<unknown> },
): Promise<void> {
  await preflightBackendStart(startInput)
  await seams.mkdir()
  await seams.spawn()
}

function seams() {
  return { mkdir: vi.fn(), spawn: vi.fn() }
}

describe('pure Backend hostname and environment guards', () => {
  it('is exported from the independent Backend package', () => {
    expect(publicPreflightBackendStart).toBe(preflightBackendStart)
  })

  it('matches safe globs case-insensitively and anchors the whole hostname', () => {
    expect(
      evaluateBackendStartGuards({
        guards: SAFE_GUARDS,
        hostname: 'LOGIN-01.EXAMPLE.TEST.',
        environment: {},
      }),
    ).toEqual({ allowed: true })
    expect(
      evaluateBackendStartGuards({
        guards: { ...SAFE_GUARDS, allowedHostnamePatterns: ['login-*'] },
        hostname: 'prefix-login-01',
        environment: {},
      }),
    ).toMatchObject({ allowed: false, error: { code: 'HOSTNAME_NOT_ALLOWED' } })
  })

  it('rejects regex syntax instead of interpolating it into the glob', () => {
    expect(
      evaluateBackendStartGuards({
        guards: { ...SAFE_GUARDS, allowedHostnamePatterns: ['login-(.*)'] },
        hostname: 'login-anything',
        environment: {},
      }),
    ).toMatchObject({ allowed: false, error: { code: 'INVALID_HOST_PATTERN' } })
  })

  it('rejects a wrong Host before mkdir or spawn', async () => {
    const effects = seams()
    await expect(
      attemptStart(input({ hostname: 'compute-01.example.test' }), effects),
    ).rejects.toMatchObject({ code: 'HOSTNAME_NOT_ALLOWED' })
    expect(effects.mkdir).not.toHaveBeenCalled()
    expect(effects.spawn).not.toHaveBeenCalled()
  })

  it.each([
    ['non-empty', { SLURM_JOB_ID: '123' }],
    ['empty', { SLURM_JOB_ID: '' }],
    ['explicit undefined', { SLURM_JOB_ID: undefined }],
  ])('rejects a %s forbidden environment marker by presence', async (_name, environment) => {
    const effects = seams()
    await expect(attemptStart(input({ environment }), effects)).rejects.toMatchObject({
      code: 'FORBIDDEN_ENVIRONMENT',
    })
    expect(effects.mkdir).not.toHaveBeenCalled()
    expect(effects.spawn).not.toHaveBeenCalled()
  })

  it('allows safe context before invoking the caller-owned mkdir/spawn seams', async () => {
    const effects = seams()
    await expect(attemptStart(input(), effects)).resolves.toBeUndefined()
    expect(effects.mkdir).toHaveBeenCalledOnce()
    expect(effects.spawn).toHaveBeenCalledOnce()
  })
})

describe('Backend runtime directory policy and read-only preflight', () => {
  it('requires an absolute runtime directory', () => {
    expect(() => assertRuntimeDirectoryPolicy('relative/run', input().runtimePolicy)).toThrowError(
      expect.objectContaining({ code: 'RUNTIME_DIR_NOT_ABSOLUTE' }),
    )
  })

  it.each([
    ['state', 'RUNTIME_DIR_OVERLAPS_STATE'],
    ['releases', 'RUNTIME_DIR_OVERLAPS_RELEASE'],
  ])('rejects runtime storage beneath persistent %s', (_name, code) => {
    const policy = input().runtimePolicy
    const runtimeDir =
      code === 'RUNTIME_DIR_OVERLAPS_STATE'
        ? join(policy.stateDir, 'run')
        : join(policy.releaseDir, 'run')
    expect(() => assertRuntimeDirectoryPolicy(runtimeDir, policy)).toThrowError(
      expect.objectContaining({ code }),
    )
  })

  it('rejects a runtime directory that contains persistent or shared roots', () => {
    const policy = input().runtimePolicy
    for (const [runtimeDir, code] of [
      [join(dir, 'persistent'), 'RUNTIME_DIR_OVERLAPS_STATE'],
      [join(dir, 'shared-home'), 'RUNTIME_DIR_UNDER_SHARED_ROOT'],
    ] as const) {
      expect(() => assertRuntimeDirectoryPolicy(runtimeDir, policy)).toThrowError(
        expect.objectContaining({ code }),
      )
    }
  })

  it('rejects a configured shared Project/home root before mkdir or spawn', async () => {
    const effects = seams()
    const startInput = input({ runtimeDir: join(dir, 'shared-home', 'runtime') })
    await expect(attemptStart(startInput, effects)).rejects.toMatchObject({
      code: 'RUNTIME_DIR_UNDER_SHARED_ROOT',
    })
    expect(effects.mkdir).not.toHaveBeenCalled()
    expect(effects.spawn).not.toHaveBeenCalled()
  })

  it('rejects an existing runtime symlink before mkdir or spawn', async () => {
    const target = join(dir, 'real-runtime')
    const runtimeDir = join(dir, 'runtime-link')
    await fs.mkdir(target)
    await fs.symlink(target, runtimeDir)
    const effects = seams()
    await expect(attemptStart(input({ runtimeDir }), effects)).rejects.toMatchObject({
      code: 'RUNTIME_DIR_SYMLINK',
    })
    expect(effects.mkdir).not.toHaveBeenCalled()
    expect(effects.spawn).not.toHaveBeenCalled()
  })

  it('rejects a symlink in an existing parent component', async () => {
    const target = join(dir, 'real-parent')
    const linkedParent = join(dir, 'linked-parent')
    await fs.mkdir(target)
    await fs.symlink(target, linkedParent)
    await expect(
      preflightRuntimeDirectory(join(linkedParent, 'missing-run')),
    ).rejects.toMatchObject({
      code: 'RUNTIME_DIR_SYMLINK',
    })
  })

  it('rejects an existing non-directory before mkdir or spawn', async () => {
    const runtimeDir = join(dir, 'runtime-file')
    await fs.writeFile(runtimeDir, 'not a directory')
    const effects = seams()
    await expect(attemptStart(input({ runtimeDir }), effects)).rejects.toMatchObject({
      code: 'RUNTIME_DIR_NOT_DIRECTORY',
    })
    expect(effects.mkdir).not.toHaveBeenCalled()
    expect(effects.spawn).not.toHaveBeenCalled()
  })

  it('accepts a missing safe tail without creating it', async () => {
    const runtimeDir = join(dir, 'node-local', 'missing-run')
    await expect(fs.access(runtimeDir)).rejects.toThrow()
    await expect(preflightBackendStart(input({ runtimeDir }))).resolves.toBe(runtimeDir)
    await expect(fs.access(runtimeDir)).rejects.toThrow()
  })
})
