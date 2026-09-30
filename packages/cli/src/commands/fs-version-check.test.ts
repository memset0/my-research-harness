import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FS_CONVENTION_VERSION, writeFsVersion } from '@memon/core'
import { inspectFsVersion, runFsVersionCheck } from './fs-version-check.js'

let projectRoot: string

beforeEach(async () => {
  projectRoot = await fs.mkdtemp(join(tmpdir(), 'memon-fs-version-check-'))
})

afterEach(async () => {
  await fs.rm(projectRoot, { recursive: true, force: true })
})

class ExitCalled extends Error {
  constructor(public exitCode: number) {
    super(`process.exit(${exitCode})`)
  }
}

interface CapturedRun {
  exitCode: number | null
  stdout: string
  stderr: string
}

async function runCapturing(fn: () => Promise<unknown>): Promise<CapturedRun> {
  const realExit = process.exit
  const realStdout = process.stdout.write.bind(process.stdout)
  const realStderr = process.stderr.write.bind(process.stderr)
  let exitCode: number | null = null
  let stdout = ''
  let stderr = ''
  process.exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitCalled(exitCode)
  }) as typeof process.exit
  process.stdout.write = ((chunk: unknown) => {
    stdout += String(chunk)
    return true
  }) as typeof process.stdout.write
  process.stderr.write = ((chunk: unknown) => {
    stderr += String(chunk)
    return true
  }) as typeof process.stderr.write
  try {
    await fn()
  } catch (err) {
    if (!(err instanceof ExitCalled)) throw err
  } finally {
    process.exit = realExit
    process.stdout.write = realStdout
    process.stderr.write = realStderr
  }
  return { exitCode, stdout, stderr }
}

describe('inspectFsVersion (pure read)', () => {
  it('returns uninitialised when no marker exists', async () => {
    const r = await inspectFsVersion(projectRoot)
    expect(r.current).toBeNull()
    expect(r.available).toBe(FS_CONVENTION_VERSION)
    expect(r.status).toBe('uninitialised')
  })

  it('returns match when marker version === FS_CONVENTION_VERSION', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await inspectFsVersion(projectRoot)
    expect(r.status).toBe('match')
    expect(r.current).toBe(FS_CONVENTION_VERSION)
  })

  it('returns behind when marker version < FS_CONVENTION_VERSION', async () => {
    // Skip cleanly when there is no legal lower version (i.e. the current
    // FS_CONVENTION_VERSION is the minimum allowed value of 1).
    if (FS_CONVENTION_VERSION <= 1) {
      const r = await inspectFsVersion(projectRoot)
      expect(['match', 'behind']).toContain(r.status)
      return
    }
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION - 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await inspectFsVersion(projectRoot)
    expect(r.status).toBe('behind')
    expect(r.current).toBe(FS_CONVENTION_VERSION - 1)
    expect(r.available).toBe(FS_CONVENTION_VERSION)
  })

  it('returns ahead when marker version > FS_CONVENTION_VERSION', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION + 1,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await inspectFsVersion(projectRoot)
    expect(r.status).toBe('ahead')
    expect(r.current).toBe(FS_CONVENTION_VERSION + 1)
  })
})

describe('runFsVersionCheck (CLI entry)', () => {
  it('exits 0 with status match when marker matches tool', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await runCapturing(() =>
      runFsVersionCheck({ projectRoot, cwd: projectRoot, format: 'json' }),
    )
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.status).toBe('match')
    expect(parsed.current).toBe(FS_CONVENTION_VERSION)
    expect(parsed.available).toBe(FS_CONVENTION_VERSION)
  })

  it('exits 0 with status uninitialised when no marker exists', async () => {
    const r = await runCapturing(() =>
      runFsVersionCheck({ projectRoot, cwd: projectRoot, format: 'json' }),
    )
    expect(r.exitCode).toBe(0)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.status).toBe('uninitialised')
    expect(parsed.current).toBeNull()
  })

  it('exits 11 (MEMON_TOO_OLD) on ahead status with status block on stdout', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION + 5,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await runCapturing(() =>
      runFsVersionCheck({ projectRoot, cwd: projectRoot, format: 'json' }),
    )
    expect(r.exitCode).toBe(11)
    const parsed = JSON.parse(r.stdout)
    expect(parsed.status).toBe('ahead')
    expect(parsed.current).toBe(FS_CONVENTION_VERSION + 5)
  })

  it('does not modify any file in .memon/ (read-only)', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const before = await fs.stat(join(projectRoot, '.memon/version.json'))
    await runCapturing(() => runFsVersionCheck({ projectRoot, cwd: projectRoot, format: 'json' }))
    const after = await fs.stat(join(projectRoot, '.memon/version.json'))
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(after.size).toBe(before.size)
  })

  it('emits human-readable output with --format human', async () => {
    await writeFsVersion(projectRoot, {
      fs_convention_version: FS_CONVENTION_VERSION,
      installed_at: '2026-05-04T10:00:00+08:00',
      last_migrated_at: null,
    })
    const r = await runCapturing(() =>
      runFsVersionCheck({ projectRoot, cwd: projectRoot, format: 'human' }),
    )
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toContain('status:')
    expect(r.stdout).toContain('match')
  })
})
