import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { loadConfig } from '@memon/core'
import { ensureAuthInitialised } from './first-run'

let dir: string
let configPath: string
let logSpy: ReturnType<typeof vi.spyOn>

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-first-run-'))
  configPath = join(dir, 'config.yml')
  await fs.mkdir(join(dir, 'a'), { recursive: true })
  // Suppress the stdout banner during tests.
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(async () => {
  logSpy.mockRestore()
  await fs.rm(dir, { recursive: true, force: true })
})

const BASE_CONFIG = `# A user comment we want preserved.
projects:
  - name: a
    root: ./a
poll:
  min_interval_ms: 1000
  max_interval_ms: 60000
`

describe('ensureAuthInitialised', () => {
  it('generates and persists a plaintext password when missing', async () => {
    await fs.writeFile(configPath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(cfg.auth).toBeUndefined()

    const result = await ensureAuthInitialised(configPath, cfg)
    expect(result.username).toBe('admin')
    expect(result.password).toMatch(/^[A-Za-z0-9_-]{20,}$/)

    // Reload should round-trip the same auth.
    const reloaded = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(reloaded.auth).toEqual(result)

    // User comments are preserved (we don't round-trip through js-yaml).
    const after = await fs.readFile(configPath, 'utf8')
    expect(after).toContain('# A user comment we want preserved.')
    expect(after).toContain('min_interval_ms: 1000')
    // Plaintext is on disk now (the whole point of this design).
    expect(after).toContain(`password: "${result.password}"`)

    // Banner was printed once.
    const banner = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(banner).toContain('username: admin')
    expect(banner).toContain(`password: ${result.password}`)
  })

  it('returns existing creds without rewriting when password already present', async () => {
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n  password: known-pass\n'
    await fs.writeFile(configPath, seed)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    const before = await fs.stat(configPath)

    const result = await ensureAuthInitialised(configPath, cfg)
    expect(result).toEqual({ username: 'alice', password: 'known-pass' })

    // mtime unchanged → no rewrite.
    const after = await fs.stat(configPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('refuses to clobber a partial auth block (when forged Config has auth: undefined)', async () => {
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n'
    await fs.writeFile(configPath, seed)

    // loadConfig itself errors on partial auth via the schema.
    await expect(
      loadConfig({ explicitPath: configPath, cwd: dir }),
    ).rejects.toThrow()

    // Forge a Config with auth undefined to test the defensive branch.
    const fakeCfg = {
      projects: [{ name: 'a', root: dir, include: [], exclude: [] }],
      poll: { minIntervalMs: 1000, maxIntervalMs: 60000, backoffFactor: 2 },
      terminal: { ttydMaxConcurrent: 16, ttydIdleTtlMinutes: 30 },
    }
    await expect(ensureAuthInitialised(configPath, fakeCfg)).rejects.toThrow(/loadConfig couldn't parse/)
  })

  it('detects concurrent edit via mtime guard and aborts', async () => {
    await fs.writeFile(configPath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!

    const realStat = fs.stat.bind(fs)
    let calls = 0
    const statSpy = vi.spyOn(fs, 'stat').mockImplementation(async (p) => {
      const real = await realStat(p as string)
      calls += 1
      if (calls === 2) {
        return { ...real, mtimeMs: real.mtimeMs + 9999 } as Awaited<ReturnType<typeof realStat>>
      }
      return real
    })
    try {
      await expect(ensureAuthInitialised(configPath, cfg)).rejects.toThrow(
        /modified during first-run/,
      )
    } finally {
      statSpy.mockRestore()
    }
  })

  it('does NOT write a ~/.cache/memon/initial-password.txt file (deprecated)', async () => {
    // Sanity-check that the new design avoids the cache-file trap. We run the
    // first-run flow and assert that no fs.writeFile was called for any path
    // outside of <dir>.
    await fs.writeFile(configPath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!

    const realWriteFile = fs.writeFile.bind(fs)
    const writes: string[] = []
    const writeSpy = vi.spyOn(fs, 'writeFile').mockImplementation(async (p, ...rest) => {
      const path = String(p)
      writes.push(path)
      return realWriteFile(p as string, ...(rest as [string]))
    })
    try {
      await ensureAuthInitialised(configPath, cfg)
    } finally {
      writeSpy.mockRestore()
    }

    // Every write should be inside the tmp dir (= configPath rewrite). No
    // ~/.cache writes.
    for (const w of writes) {
      expect(w.startsWith(dir)).toBe(true)
    }
  })
})
