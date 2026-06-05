import { exec } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  AgentKindError,
  collapseHome,
  detectAgent,
  nowIsoLocal,
  probeGitBranch,
} from './auto-context.js'

const execp = promisify(exec)

describe('detectAgent', () => {
  it('explicit wins over CLAUDECODE=1', () => {
    expect(detectAgent({ CLAUDECODE: '1' }, 'codex')).toBe('codex')
  })

  it('no explicit + CLAUDECODE=1 → claude', () => {
    expect(detectAgent({ CLAUDECODE: '1' })).toBe('claude')
  })

  it('no explicit + no CLAUDECODE → unknown', () => {
    expect(detectAgent({})).toBe('unknown')
  })

  it('empty CLAUDECODE treated as unset', () => {
    expect(detectAgent({ CLAUDECODE: '' })).toBe('unknown')
  })

  it('accepts well-formed but unknown agent literal', () => {
    expect(detectAgent({}, 'my-experimental-shell')).toBe('my-experimental-shell')
  })

  it('throws AgentKindError on malformed --agent', () => {
    expect(() => detectAgent({}, 'MyShell!')).toThrow(AgentKindError)
    expect(() => detectAgent({}, '1claude')).toThrow(AgentKindError)
    expect(() => detectAgent({}, 'a'.repeat(33))).toThrow(AgentKindError)
  })
})

describe('collapseHome', () => {
  it('collapses HOME prefix', () => {
    expect(collapseHome('/home/alice/work', '/home/alice')).toBe('~/work')
  })

  it('collapses bare HOME to ~', () => {
    expect(collapseHome('/home/alice', '/home/alice')).toBe('~')
  })

  it('does NOT collapse a partial-prefix mismatch', () => {
    expect(collapseHome('/home/alice2', '/home/alice')).toBe('/home/alice2')
  })

  it('returns cwd unchanged when not under home', () => {
    expect(collapseHome('/tmp/x', '/home/alice')).toBe('/tmp/x')
  })

  it('returns cwd unchanged when home undefined', () => {
    expect(collapseHome('/tmp/x', undefined)).toBe('/tmp/x')
  })
})

describe('probeGitBranch', () => {
  let dir: string

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), 'memon-notify-git-'))
  })

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true })
  })

  it('returns branch + shortSha inside a fresh git repo', async () => {
    // Create a one-commit repo using `git init -b main`.
    await execp('git init -b main', { cwd: dir })
    await execp('git config user.email test@example.com', { cwd: dir })
    await execp('git config user.name Test', { cwd: dir })
    await fs.writeFile(join(dir, 'a.txt'), 'hi\n')
    await execp('git add a.txt && git commit -m "init"', { cwd: dir })

    const info = await probeGitBranch(dir)
    expect(info).toBeDefined()
    expect(info!.branch).toBe('main')
    expect(info!.shortSha).toMatch(/^[0-9a-f]{7,}$/)
  })

  it('returns undefined when cwd is not in a git work-tree', async () => {
    // tmp dir without `git init`.
    const info = await probeGitBranch(dir)
    expect(info).toBeUndefined()
  })

  it('returns undefined when git is unfindable (empty PATH)', async () => {
    // We can't easily strip PATH from spawn() here without env override,
    // but the spawn-throw path also covers ENOENT. Simulate by probing
    // a non-existent cwd — spawn throws or git fails with non-zero.
    const info = await probeGitBranch('/this/path/does/not/exist/9z9z9z')
    expect(info).toBeUndefined()
  })

  it('honours an aggressive timeout without throwing', async () => {
    // 1 ms timeout — even on a healthy repo this should fire faster than
    // the probe completes. The function MUST return undefined, not throw.
    await execp('git init -b main', { cwd: dir })
    await execp('git config user.email test@example.com', { cwd: dir })
    await execp('git config user.name Test', { cwd: dir })
    await fs.writeFile(join(dir, 'a.txt'), 'hi\n')
    await execp('git add a.txt && git commit -m "init"', { cwd: dir })

    const info = await probeGitBranch(dir, 1)
    // Either the timeout fired (undefined) or the probe was somehow
    // extremely fast (very unlikely but allowable). Both are OK as long
    // as nothing throws.
    expect(info === undefined || (info && info.branch === 'main')).toBe(true)
  })
})

describe('nowIsoLocal', () => {
  it('emits ISO8601 with timezone offset (not Z)', () => {
    const s = nowIsoLocal()
    expect(s).toMatch(/T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    expect(s.endsWith('Z')).toBe(false)
  })

  it('is deterministic given a fixed Date', () => {
    const d = new Date('2026-05-30T04:00:00Z')
    const s = nowIsoLocal(d)
    // Don't assert the local-tz outcome (varies by host); just shape.
    expect(s).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
  })
})
