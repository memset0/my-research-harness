import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigError, implicitCwdProject, loadConfig } from './load.js'

let dir: string

beforeEach(async () => {
  dir = await fs.mkdtemp(join(tmpdir(), 'memon-config-'))
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

const VALID = `
projects:
  - name: alpha
    root: ./alpha
  - name: beta
    root: /abs/beta
    exclude: [dist]
poll:
  min_interval_ms: 500
  max_interval_ms: 60000
  backoff_factor: 3
`

describe('loadConfig', () => {
  it('reads cwd/config.yml by default', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    await fs.mkdir(join(dir, 'alpha'), { recursive: true })
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg).not.toBeNull()
    expect(cfg!.projects).toHaveLength(2)
    expect(cfg!.projects[0]!.name).toBe('alpha')
    expect(cfg!.projects[0]!.root).toBe(resolve(dir, 'alpha'))
    expect(cfg!.projects[1]!.root).toBe('/abs/beta')
    expect(cfg!.projects[1]!.exclude).toEqual(['dist'])
    expect(cfg!.poll.minIntervalMs).toBe(500)
    expect(cfg!.poll.backoffFactor).toBe(3)
  })

  it('returns null when no default config and no explicit path', async () => {
    expect(await loadConfig({ cwd: dir })).toBeNull()
  })

  it('explicitPath overrides cwd default', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const otherDir = await fs.mkdtemp(join(tmpdir(), 'memon-config-other-'))
    try {
      const otherPath = join(otherDir, 'special.yml')
      await fs.writeFile(otherPath, VALID.replace('alpha', 'special'))
      const cfg = await loadConfig({ cwd: dir, explicitPath: otherPath })
      expect(cfg!.projects[0]!.name).toBe('special')
    } finally {
      await fs.rm(otherDir, { recursive: true, force: true })
    }
  })

  it('throws ConfigError when explicit file missing', async () => {
    await expect(
      loadConfig({ cwd: dir, explicitPath: join(dir, 'missing.yml') }),
    ).rejects.toBeInstanceOf(ConfigError)
  })

  it('throws ConfigError on invalid YAML', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: oops')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('throws ConfigError on schema violation', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: []\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects max < min and backoff_factor <= 1', async () => {
    const bad1 = `
projects:
  - { name: a, root: ./a }
poll:
  min_interval_ms: 1000
  max_interval_ms: 500
`
    await fs.writeFile(join(dir, 'config.yml'), bad1)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)

    const bad2 = `
projects:
  - { name: a, root: ./a }
poll:
  min_interval_ms: 1000
  max_interval_ms: 60000
  backoff_factor: 1
`
    await fs.writeFile(join(dir, 'config.yml'), bad2)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('loadConfig auth block', () => {
  it('parses a complete auth block to camelCase', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  username: alice
  password: secret123
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.auth).toEqual({
      username: 'alice',
      password: 'secret123',
    })
  })

  it('defaults username to "admin" when omitted', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  password: secret123
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.auth).toEqual({
      username: 'admin',
      password: 'secret123',
    })
  })

  it('returns auth: undefined when block is absent', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.auth).toBeUndefined()
  })

  it('throws ConfigError when password is the wrong type', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  password: 12345
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('throws ConfigError when password is empty string', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  password: ""
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('implicitCwdProject', () => {
  it('synthesizes single-project config rooted at cwd', () => {
    const cfg = implicitCwdProject('/some/where')
    expect(cfg.projects).toHaveLength(1)
    expect(cfg.projects[0]!.root).toBe('/some/where')
    expect(cfg.projects[0]!.name).toBe('(cwd)')
    expect(cfg.poll.minIntervalMs).toBe(1000)
  })
})
