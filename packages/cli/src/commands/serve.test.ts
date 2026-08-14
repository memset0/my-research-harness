import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const childProcessMocks = vi.hoisted(() => ({ spawn: vi.fn() }))

vi.mock('node:child_process', () => ({ spawn: childProcessMocks.spawn }))

import { runServe } from './serve.js'

class ExitCalled extends Error {
  constructor(public readonly exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

interface CapturedStdio {
  stdout: string[]
  stderr: string[]
}

let repoRoot: string
let realExit: typeof process.exit
let realStdoutWrite: typeof process.stdout.write
let realStderrWrite: typeof process.stderr.write
let captured: CapturedStdio

beforeEach(async () => {
  repoRoot = await fs.mkdtemp(join(tmpdir(), 'memon-serve-'))
  await fs.writeFile(join(repoRoot, 'pnpm-workspace.yaml'), 'packages: []\n', 'utf8')
  await fs.mkdir(join(repoRoot, 'apps', 'web'), { recursive: true })

  childProcessMocks.spawn.mockReset()
  childProcessMocks.spawn.mockReturnValue({ on: vi.fn() })

  captured = { stdout: [], stderr: [] }
  realExit = process.exit
  realStdoutWrite = process.stdout.write
  realStderrWrite = process.stderr.write
  process.exit = ((code?: number) => {
    throw new ExitCalled(code ?? 0)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    captured.stdout.push(String(chunk))
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    captured.stderr.push(String(chunk))
    return true
  }) as typeof process.stderr.write
})

afterEach(async () => {
  process.exit = realExit
  process.stdout.write = realStdoutWrite
  process.stderr.write = realStderrWrite
  await fs.rm(repoRoot, { recursive: true, force: true })
})

describe('runServe config path policy', () => {
  it('rejects an explicit config.example.yml with structured stderr before spawn', async () => {
    const examplePath = join(repoRoot, 'config.example.yml')
    await fs.writeFile(examplePath, 'projects: []\n', 'utf8')

    await expect(
      runServe({
        configPath: './config.example.yml',
        cwd: repoRoot,
        dev: true,
        port: 3737,
      }),
    ).rejects.toMatchObject({ exitCode: 2 })

    expect(childProcessMocks.spawn).not.toHaveBeenCalled()
    expect(captured.stdout).toEqual([])
    expect(JSON.parse(captured.stderr.join(''))).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message:
          'config.example.yml is a protected template and cannot be used as runtime configuration; copy it to config.yml (or another filename) first',
        details: { configPath: examplePath },
      },
    })
  })

  it('does not treat config.example.yml as the default runtime config', async () => {
    await fs.writeFile(join(repoRoot, 'config.example.yml'), 'projects: []\n', 'utf8')

    await expect(runServe({ cwd: repoRoot, dev: false, port: 3737 })).rejects.toMatchObject({
      exitCode: 2,
    })

    expect(childProcessMocks.spawn).not.toHaveBeenCalled()
    expect(captured.stdout).toEqual([])
    expect(JSON.parse(captured.stderr.join(''))).toEqual({
      error: {
        code: 'BAD_REQUEST',
        message:
          'no instance configuration found; copy config.example.yml to config.yml or pass --config <path> to another instance file',
        details: { cwd: repoRoot, repoRoot },
      },
    })
  })

  it('allows a custom config basename and passes its absolute path to Next', async () => {
    const customPath = join(repoRoot, 'cluster-config.yml')
    await fs.writeFile(customPath, 'projects: []\n', 'utf8')

    await runServe({
      configPath: './cluster-config.yml',
      cwd: repoRoot,
      dev: true,
      port: 4747,
    })

    expect(childProcessMocks.spawn).toHaveBeenCalledOnce()
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'next', 'dev', '-p', '4747'],
      expect.objectContaining({
        cwd: join(repoRoot, 'apps', 'web'),
        stdio: 'inherit',
        env: expect.objectContaining({ MEMON_CONFIG_PATH: customPath }),
      }),
    )
  })

  it('continues to discover config.yml by default', async () => {
    const configPath = join(repoRoot, 'config.yml')
    await fs.writeFile(configPath, 'projects: []\n', 'utf8')

    await runServe({ cwd: repoRoot, dev: false, port: 3737 })

    expect(childProcessMocks.spawn).toHaveBeenCalledOnce()
    expect(childProcessMocks.spawn).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'next', 'start', '-p', '3737'],
      expect.objectContaining({
        env: expect.objectContaining({ MEMON_CONFIG_PATH: configPath }),
      }),
    )
  })
})
