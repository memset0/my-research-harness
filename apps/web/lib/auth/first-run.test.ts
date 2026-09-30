import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadConfig } from '@memon/core'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __testAppendSessionSecretToAuthBlock, ensureAuthInitialised } from './first-run'

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

const CENTRAL_SERVICE_TOKEN = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const CENTRAL_CONFIG = `# Central runbook: preserve this line byte-for-byte.
central:
  hosts:
    - id: host-a
      # Rotation note must remain adjacent to this synthetic Host.
      tokens: { current: ${CENTRAL_SERVICE_TOKEN} }
      transport: { kind: url, base_url: https://backend.example.test }
`

describe('ensureAuthInitialised', () => {
  it('generates and persists a plaintext password AND session_secret when both missing', async () => {
    await fs.writeFile(configPath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(cfg.auth).toBeUndefined()

    const result = await ensureAuthInitialised(configPath, cfg)
    expect(result.username).toBe('admin')
    expect(result.password).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(result.sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    // Reload should round-trip the same auth.
    const reloaded = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(reloaded.auth).toEqual(result)

    // User comments are preserved (we don't round-trip through js-yaml).
    const after = await fs.readFile(configPath, 'utf8')
    expect(after).toContain('# A user comment we want preserved.')
    expect(after).toContain('min_interval_ms: 1000')
    // Plaintext is on disk now (the whole point of this design).
    expect(after).toContain(`password: "${result.password}"`)
    expect(after).toContain(`session_secret: "${result.sessionSecret}"`)

    // Banner was printed once. The banner shows the password but NOT the
    // session_secret (the secret is opaque to the user; the password is
    // what they need to log in).
    const banner = logSpy.mock.calls.map((c) => String(c[0])).join('\n')
    expect(banner).toContain('username: admin')
    expect(banner).toContain(`password: ${result.password}`)
    expect(banner).not.toContain(result.sessionSecret!)
  })

  it('adds session_secret to an existing auth block when only password is present', async () => {
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n  password: known-pass\n'
    await fs.writeFile(configPath, seed)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(cfg.auth).toBeDefined()
    expect(cfg.auth!.sessionSecret).toBeUndefined()

    const result = await ensureAuthInitialised(configPath, cfg)
    expect(result.username).toBe('alice')
    expect(result.password).toBe('known-pass')
    expect(result.sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/)

    // Reload round-trips.
    const reloaded = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(reloaded.auth).toEqual(result)

    // No banner — the password was already set.
    expect(logSpy).not.toHaveBeenCalled()

    // The original two lines are preserved.
    const after = await fs.readFile(configPath, 'utf8')
    expect(after).toContain('username: alice')
    expect(after).toContain('password: known-pass')
    expect(after).toContain(`session_secret: "${result.sessionSecret}"`)
  })

  it('keeps central first-run config at 0600 and preserves every pre-existing byte/comment', async () => {
    await fs.writeFile(configPath, CENTRAL_CONFIG, { mode: 0o600 })
    await fs.chmod(configPath, 0o600)
    const before = await fs.readFile(configPath, 'utf8')
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(cfg.central).toBeDefined()
    expect(cfg.auth).toBeUndefined()

    const result = await ensureAuthInitialised(configPath, cfg)
    const after = await fs.readFile(configPath, 'utf8')

    expect(after.slice(0, before.length)).toBe(before)
    expect(after).toContain('# Central runbook: preserve this line byte-for-byte.')
    expect(after).toContain('# Rotation note must remain adjacent to this synthetic Host.')
    expect(after).toContain(`password: "${result.password}"`)
    expect(after).toContain(`session_secret: "${result.sessionSecret}"`)
    expect((await fs.lstat(configPath)).mode & 0o7777).toBe(0o600)

    const banner = logSpy.mock.calls.map((call) => String(call[0])).join('\n')
    expect(banner).not.toContain(CENTRAL_SERVICE_TOKEN)
    expect(banner).not.toContain(result.sessionSecret!)

    const reloaded = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    expect(reloaded.auth).toEqual(result)
  })

  it('inserts only the missing central session secret and preserves surrounding comments', async () => {
    const seed =
      CENTRAL_CONFIG +
      '\n# Human auth note.\nauth:\n  username: alice\n  password: known-pass\n  # Keep auth comments too.\n'
    await fs.writeFile(configPath, seed, { mode: 0o600 })
    await fs.chmod(configPath, 0o600)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!

    const result = await ensureAuthInitialised(configPath, cfg)
    const after = await fs.readFile(configPath, 'utf8')
    const inserted = `  session_secret: ${JSON.stringify(result.sessionSecret)}\n`

    expect(after.replace(inserted, '')).toBe(seed)
    expect((await fs.lstat(configPath)).mode & 0o7777).toBe(0o600)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('rejects config.example.yml before stat or write when the auth block is missing', async () => {
    const examplePath = join(dir, 'config.example.yml')
    await fs.writeFile(examplePath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: examplePath, cwd: dir }))!
    const beforeText = await fs.readFile(examplePath, 'utf8')
    const beforeStat = await fs.stat(examplePath)

    const statSpy = vi.spyOn(fs, 'stat')
    const writeSpy = vi.spyOn(fs, 'writeFile')
    try {
      await expect(ensureAuthInitialised(examplePath, cfg)).rejects.toThrow(
        /config\.example\.yml.*template.*runtime code never writes/s,
      )
      expect(statSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
    } finally {
      statSpy.mockRestore()
      writeSpy.mockRestore()
    }

    expect(await fs.readFile(examplePath, 'utf8')).toBe(beforeText)
    expect((await fs.stat(examplePath)).mtimeMs).toBe(beforeStat.mtimeMs)
    expect(
      (await fs.readdir(dir)).filter((name) =>
        name.startsWith('config.example.yml.first-run-tmp.'),
      ),
    ).toEqual([])
  })

  it('rejects config.example.yml before stat or write when session_secret is missing', async () => {
    const examplePath = join(dir, 'config.example.yml')
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n  password: known-pass\n'
    await fs.writeFile(examplePath, seed)
    const cfg = (await loadConfig({ explicitPath: examplePath, cwd: dir }))!
    const beforeText = await fs.readFile(examplePath, 'utf8')
    const beforeStat = await fs.stat(examplePath)

    const statSpy = vi.spyOn(fs, 'stat')
    const writeSpy = vi.spyOn(fs, 'writeFile')
    try {
      await expect(ensureAuthInitialised(examplePath, cfg)).rejects.toThrow(
        /config\.example\.yml.*template.*runtime code never writes/s,
      )
      expect(statSpy).not.toHaveBeenCalled()
      expect(writeSpy).not.toHaveBeenCalled()
    } finally {
      statSpy.mockRestore()
      writeSpy.mockRestore()
    }

    expect(await fs.readFile(examplePath, 'utf8')).toBe(beforeText)
    expect((await fs.stat(examplePath)).mtimeMs).toBe(beforeStat.mtimeMs)
    expect(
      (await fs.readdir(dir)).filter((name) =>
        name.startsWith('config.example.yml.first-run-tmp.'),
      ),
    ).toEqual([])
  })

  it('persists generated auth to an explicitly selected custom instance filename', async () => {
    const customPath = join(dir, 'cluster.yml')
    await fs.writeFile(customPath, BASE_CONFIG)
    const cfg = (await loadConfig({ explicitPath: customPath, cwd: dir }))!

    const result = await ensureAuthInitialised(customPath, cfg)
    const reloaded = (await loadConfig({ explicitPath: customPath, cwd: dir }))!
    expect(reloaded.auth).toEqual(result)
    expect(result.password).toMatch(/^[A-Za-z0-9_-]{20,}$/)
    expect(result.sessionSecret).toMatch(/^[A-Za-z0-9_-]{40,}$/)
    await expect(fs.access(join(dir, 'config.example.yml'))).rejects.toThrow()
  })

  it('returns existing creds without rewriting when both password and session_secret are present', async () => {
    const seed =
      BASE_CONFIG +
      '\nauth:\n  username: alice\n  password: known-pass\n  session_secret: existing-secret-abc123\n'
    await fs.writeFile(configPath, seed)
    const cfg = (await loadConfig({ explicitPath: configPath, cwd: dir }))!
    const before = await fs.stat(configPath)

    const result = await ensureAuthInitialised(configPath, cfg)
    expect(result).toEqual({
      username: 'alice',
      password: 'known-pass',
      sessionSecret: 'existing-secret-abc123',
    })

    // mtime unchanged → no rewrite.
    const after = await fs.stat(configPath)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('refuses to clobber a partial auth block (when forged Config has auth: undefined)', async () => {
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n'
    await fs.writeFile(configPath, seed)

    // loadConfig itself errors on partial auth via the schema.
    await expect(loadConfig({ explicitPath: configPath, cwd: dir })).rejects.toThrow()

    // Forge a Config with auth undefined to test the defensive branch.
    const fakeCfg = {
      projects: [{ name: 'a', root: dir, include: [], exclude: [] }],
      poll: { minIntervalMs: 1000, maxIntervalMs: 60000, backoffFactor: 2 },
      slurm: { totalNodes: -1 },
      gitStatus: { intervalMs: 10_000 },
    }
    await expect(ensureAuthInitialised(configPath, fakeCfg)).rejects.toThrow(
      /loadConfig couldn't parse/,
    )
  })

  it('detects concurrent edit via mtime guard and aborts (fresh auth)', async () => {
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

  it('detects concurrent edit via mtime guard and aborts (session_secret append path)', async () => {
    const seed = BASE_CONFIG + '\nauth:\n  username: alice\n  password: known-pass\n'
    await fs.writeFile(configPath, seed)
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

    for (const w of writes) {
      expect(w.startsWith(dir)).toBe(true)
    }
  })
})

describe('appendSessionSecretToAuthBlock', () => {
  it('inserts the new line at the end of an indented auth block', () => {
    const before =
      'projects:\n  - name: a\n    root: ./a\nauth:\n  username: alice\n  password: pw\n'
    const after = __testAppendSessionSecretToAuthBlock(before, 'NEW-SECRET')
    expect(after).toContain(
      'auth:\n  username: alice\n  password: pw\n  session_secret: "NEW-SECRET"',
    )
  })

  it('preserves trailing content after the auth block', () => {
    const before = 'auth:\n  username: alice\n  password: pw\n\nlegacy_plugin:\n  retries: 8\n'
    const after = __testAppendSessionSecretToAuthBlock(before, 'NEW-SECRET')
    expect(after).toContain('  session_secret: "NEW-SECRET"\n\nlegacy_plugin:')
    expect(after).toContain('retries: 8')
  })

  it('matches the existing auth-block indentation if non-default', () => {
    const before = 'auth:\n    username: alice\n    password: pw\n'
    const after = __testAppendSessionSecretToAuthBlock(before, 'NEW-SECRET')
    expect(after).toContain('    session_secret: "NEW-SECRET"')
  })

  it('handles auth: as the last block (no trailing non-indented line)', () => {
    const before = 'auth:\n  username: alice\n  password: pw'
    const after = __testAppendSessionSecretToAuthBlock(before, 'NEW-SECRET')
    expect(after.endsWith('  session_secret: "NEW-SECRET"')).toBe(true)
  })
})
