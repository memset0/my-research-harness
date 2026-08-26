import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_TARGETS,
  type AgentName,
  maybeOfferAgentsLink,
  parseAgentList,
  runInstallSkills,
} from './install-skills.js'

// ----- shared fixture: a fake bundled skills source dir -----

let skillsSrc: string
let prevSkillsEnv: string | undefined

const FAKE_SKILLS = ['memon-foo', 'memon-bar'] as const
const FAKE_PREFLIGHT = '# fake preflight\nbody\n'

beforeEach(async () => {
  // Build a fake @memon/skills source directory so tests don't depend on the
  // real bundled skills. Each fake skill has a single SKILL.md file, plus a
  // sibling PREFLIGHT.md the synchroniser deposits as a sibling per target.
  skillsSrc = await fs.mkdtemp(join(tmpdir(), 'memon-skills-src-'))
  for (const name of FAKE_SKILLS) {
    const dir = join(skillsSrc, name)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(join(dir, 'SKILL.md'), `# ${name}\n`)
  }
  await fs.writeFile(join(skillsSrc, 'PREFLIGHT.md'), FAKE_PREFLIGHT)
  prevSkillsEnv = process.env.MEMON_SKILLS_DIR
  process.env.MEMON_SKILLS_DIR = skillsSrc
})

afterEach(async () => {
  if (prevSkillsEnv === undefined) delete process.env.MEMON_SKILLS_DIR
  else process.env.MEMON_SKILLS_DIR = prevSkillsEnv
  await fs.rm(skillsSrc, { recursive: true, force: true })
})

// ----- helpers -----

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

// ----- parseAgentList -----

describe('parseAgentList', () => {
  it('returns all three agents when input is undefined', () => {
    expect(parseAgentList(undefined)).toEqual(['claude', 'codex', 'opencode'])
  })

  it('expands "all" to all three agents', () => {
    expect(parseAgentList('all')).toEqual(['claude', 'codex', 'opencode'])
  })

  it('parses a single agent', () => {
    expect(parseAgentList('claude')).toEqual(['claude'])
  })

  it('parses comma-separated subset and preserves canonical order', () => {
    expect(parseAgentList('opencode,claude')).toEqual(['claude', 'opencode'])
  })

  it('deduplicates repeated agents', () => {
    expect(parseAgentList('claude,claude,codex')).toEqual(['claude', 'codex'])
  })

  it('rejects unknown agent name with BAD_REQUEST exit 2', async () => {
    const r = await runCapturing(async () => {
      parseAgentList('claude,bard')
    })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('BAD_REQUEST')
    expect(r.stderr).toContain('bard')
  })

  it('rejects "all" mixed with explicit names', async () => {
    const r = await runCapturing(async () => {
      parseAgentList('all,claude')
    })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('BAD_REQUEST')
  })

  it('rejects an empty list', async () => {
    const r = await runCapturing(async () => {
      parseAgentList(',,')
    })
    expect(r.exitCode).toBe(2)
    expect(r.stderr).toContain('BAD_REQUEST')
  })
})

// ----- runInstallSkills: target derivation + copying -----

describe('runInstallSkills — multi-target install', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(join(tmpdir(), 'memon-install-'))
  })
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  async function runDefault(
    opts: {
      agents?: AgentName[]
      target?: string
      dryRun?: boolean
      format?: 'json' | 'human'
    } = {},
  ) {
    return runCapturing(async () => {
      await runInstallSkills({
        // Skip projectRoot when an explicit target is supplied — they're
        // mutually exclusive in resolveTargets.
        projectRoot: opts.target ? undefined : projectRoot,
        cwd: projectRoot,
        format: opts.format ?? 'json',
        agents: opts.agents,
        target: opts.target,
        dryRun: opts.dryRun,
      })
    })
  }

  it('default install populates all three agent dirs', async () => {
    const r = await runDefault()
    expect(r.exitCode).toBeNull()
    for (const sub of Object.values(AGENT_TARGETS)) {
      const dir = join(projectRoot, sub)
      const entries = await fs.readdir(dir)
      // Skill dirs + the PREFLIGHT.md sibling.
      expect(entries.sort()).toEqual([...FAKE_SKILLS, 'PREFLIGHT.md'].sort())
      for (const name of FAKE_SKILLS) {
        const skillFile = await fs.readFile(join(dir, name, 'SKILL.md'), 'utf8')
        expect(skillFile).toBe(`# ${name}\n`)
      }
    }
    const json = JSON.parse(r.stdout)
    expect(json.targets.map((t: { agent: string }) => t.agent)).toEqual([
      'claude',
      'codex',
      'opencode',
    ])
  })

  it('--agent claude only writes .claude/skills', async () => {
    await runDefault({ agents: ['claude'] })
    expect(await dirExists(join(projectRoot, AGENT_TARGETS.claude))).toBe(true)
    expect(await dirExists(join(projectRoot, AGENT_TARGETS.codex))).toBe(false)
    expect(await dirExists(join(projectRoot, AGENT_TARGETS.opencode))).toBe(false)
  })

  it('--agent claude,opencode writes exactly those two', async () => {
    const r = await runDefault({ agents: ['claude', 'opencode'] })
    const json = JSON.parse(r.stdout)
    expect(json.targets.map((t: { agent: string }) => t.agent)).toEqual(['claude', 'opencode'])
    expect(await dirExists(join(projectRoot, AGENT_TARGETS.codex))).toBe(false)
  })

  it('--agent all matches the omit-flag default', async () => {
    const r1 = await runDefault({ agents: ['claude', 'codex', 'opencode'] })
    const j1 = JSON.parse(r1.stdout)
    const r2 = await runDefault()
    const j2 = JSON.parse(r2.stdout)
    expect(j1.targets.map((t: { agent: string }) => t.agent)).toEqual(
      j2.targets.map((t: { agent: string }) => t.agent),
    )
  })

  it('--target sets a single explicit target with agent: null', async () => {
    const explicit = join(projectRoot, 'custom', 'skills')
    const r = await runDefault({ target: explicit })
    const json = JSON.parse(r.stdout)
    expect(json.targets.length).toBe(1)
    expect(json.targets[0].agent).toBeNull()
    expect(json.targets[0].path).toBe(explicit)
    expect(await dirExists(explicit)).toBe(true)
  })

  it('removes stale memon-* dirs independently in each target', async () => {
    const stale = 'memon-notify'
    for (const sub of Object.values(AGENT_TARGETS)) {
      await fs.mkdir(join(projectRoot, sub, stale), { recursive: true })
      await fs.writeFile(join(projectRoot, sub, stale, 'SKILL.md'), '# old\n')
    }
    const r = await runDefault()
    const json = JSON.parse(r.stdout)
    for (const t of json.targets) {
      expect(t.removed).toContain(stale)
    }
    for (const sub of Object.values(AGENT_TARGETS)) {
      expect(await dirExists(join(projectRoot, sub, stale))).toBe(false)
    }
  })

  it('preserves non-namespaced skill dirs byte-for-byte in each target', async () => {
    const survivors: { sub: string; dir: string; file: string; content: string }[] = []
    let i = 0
    for (const sub of Object.values(AGENT_TARGETS)) {
      const dir = `survivor-${i++}`
      await fs.mkdir(join(projectRoot, sub, dir), { recursive: true })
      const file = join(projectRoot, sub, dir, 'note.md')
      const content = `keep me ${dir}\n`
      await fs.writeFile(file, content)
      survivors.push({ sub, dir, file, content })
    }
    await runDefault()
    for (const s of survivors) {
      const after = await fs.readFile(s.file, 'utf8')
      expect(after).toBe(s.content)
    }
  })

  it('--dry-run produces targets[] without touching any fs', async () => {
    const r = await runDefault({ dryRun: true })
    const json = JSON.parse(r.stdout)
    expect(json.dryRun).toBe(true)
    expect(json.targets.length).toBe(3)
    for (const sub of Object.values(AGENT_TARGETS)) {
      expect(await dirExists(join(projectRoot, sub))).toBe(false)
    }
  })
})

// ----- runInstallSkills: PREFLIGHT.md sibling deposit -----

describe('runInstallSkills — PREFLIGHT.md sibling', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(join(tmpdir(), 'memon-preflight-'))
  })
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  async function runJson(opts: { agents?: AgentName[]; target?: string; dryRun?: boolean } = {}) {
    return runCapturing(async () => {
      await runInstallSkills({
        projectRoot: opts.target ? undefined : projectRoot,
        cwd: projectRoot,
        format: 'json',
        agents: opts.agents,
        target: opts.target,
        dryRun: opts.dryRun,
      })
    })
  }

  it('deposits PREFLIGHT.md as a sibling in each populated target with byte-equal content', async () => {
    const r = await runJson()
    const json = JSON.parse(r.stdout)
    for (const t of json.targets) {
      // installed[] includes the literal "PREFLIGHT.md".
      expect(t.installed).toContain('PREFLIGHT.md')
      // file exists on disk with byte-equal content.
      const onDisk = await fs.readFile(join(t.path, 'PREFLIGHT.md'), 'utf8')
      expect(onDisk).toBe(FAKE_PREFLIGHT)
    }
  })

  it('--agent claude deposits PREFLIGHT.md only in the claude target', async () => {
    await runJson({ agents: ['claude'] })
    expect(await pathExists(join(projectRoot, AGENT_TARGETS.claude, 'PREFLIGHT.md'))).toBe(true)
    expect(await pathExists(join(projectRoot, AGENT_TARGETS.codex, 'PREFLIGHT.md'))).toBe(false)
    expect(await pathExists(join(projectRoot, AGENT_TARGETS.opencode, 'PREFLIGHT.md'))).toBe(false)
  })

  it('--target deposits PREFLIGHT.md in the explicit target dir', async () => {
    const explicit = join(projectRoot, 'custom', 'skills')
    const r = await runJson({ target: explicit })
    const json = JSON.parse(r.stdout)
    expect(json.targets[0].installed).toContain('PREFLIGHT.md')
    expect(await pathExists(join(explicit, 'PREFLIGHT.md'))).toBe(true)
  })

  it('--dry-run reports PREFLIGHT.md in installed[] but does not write it', async () => {
    const r = await runJson({ dryRun: true })
    const json = JSON.parse(r.stdout)
    for (const t of json.targets) {
      expect(t.installed).toContain('PREFLIGHT.md')
      expect(await pathExists(join(t.path, 'PREFLIGHT.md'))).toBe(false)
    }
  })

  it('overwrites a stale PREFLIGHT.md in the target', async () => {
    const claudeDir = join(projectRoot, AGENT_TARGETS.claude)
    await fs.mkdir(claudeDir, { recursive: true })
    await fs.writeFile(join(claudeDir, 'PREFLIGHT.md'), 'STALE GARBAGE\n')
    await runJson({ agents: ['claude'] })
    const after = await fs.readFile(join(claudeDir, 'PREFLIGHT.md'), 'utf8')
    expect(after).toBe(FAKE_PREFLIGHT)
  })

  it('leaves non-PREFLIGHT sibling files in the target untouched', async () => {
    const claudeDir = join(projectRoot, AGENT_TARGETS.claude)
    await fs.mkdir(claudeDir, { recursive: true })
    const extra = join(claudeDir, 'extra-doc.md')
    const notes = join(claudeDir, 'notes.txt')
    await fs.writeFile(extra, 'keep extra\n')
    await fs.writeFile(notes, 'keep notes\n')
    await runJson({ agents: ['claude'] })
    expect(await fs.readFile(extra, 'utf8')).toBe('keep extra\n')
    expect(await fs.readFile(notes, 'utf8')).toBe('keep notes\n')
  })

  it('PREFLIGHT.md is NOT included in removed[] under the memon-* replacement scope', async () => {
    const claudeDir = join(projectRoot, AGENT_TARGETS.claude)
    await fs.mkdir(claudeDir, { recursive: true })
    // Pre-populate a stale memon-* dir AND a stale PREFLIGHT.md.
    await fs.mkdir(join(claudeDir, 'memon-renamed-old'), { recursive: true })
    await fs.writeFile(join(claudeDir, 'memon-renamed-old', 'SKILL.md'), '# old\n')
    await fs.writeFile(join(claudeDir, 'PREFLIGHT.md'), 'STALE\n')
    const r = await runJson({ agents: ['claude'] })
    const json = JSON.parse(r.stdout)
    // memon-* is in removed[]; PREFLIGHT.md is NOT.
    expect(json.targets[0].removed).toContain('memon-renamed-old')
    expect(json.targets[0].removed).not.toContain('PREFLIGHT.md')
  })
})

// ----- maybeOfferAgentsLink (unit-level) -----

describe('maybeOfferAgentsLink', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(join(tmpdir(), 'memon-agentslink-'))
  })
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  it('returns action: "none" when AGENTS.md already exists', async () => {
    await fs.writeFile(join(projectRoot, 'AGENTS.md'), '# A\n')
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: false, format: 'json' })
    expect(r.action).toBe('none')
    expect(r.agentsMdExists).toBe(true)
    // not modified
    const text = await fs.readFile(join(projectRoot, 'AGENTS.md'), 'utf8')
    expect(text).toBe('# A\n')
  })

  it('returns action: "none" when neither file exists', async () => {
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: false, format: 'json' })
    expect(r.action).toBe('none')
    expect(r.claudeMdExists).toBe(false)
  })

  it('skipped-non-tty when format=json and only CLAUDE.md exists', async () => {
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: false, format: 'json' })
    expect(r.action).toBe('skipped-non-tty')
    expect(await pathExists(join(projectRoot, 'AGENTS.md'))).toBe(false)
  })

  it('skipped-dry-run when --dry-run and only CLAUDE.md exists', async () => {
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: true, format: 'human' })
    expect(r.action).toBe('skipped-dry-run')
    expect(await pathExists(join(projectRoot, 'AGENTS.md'))).toBe(false)
  })

  it('skipped-non-tty when format=human but stdin is not a TTY', async () => {
    // The vitest environment runs without an interactive TTY, so isTTY is
    // falsy. This path verifies the non-TTY guard fires even in human mode.
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: false, format: 'human' })
    expect(r.action).toBe('skipped-non-tty')
  })

  it('reports failed when symlink creation throws', async () => {
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    // Force the TTY path AND mock symlink to throw. We accept by stubbing
    // process.stdin.isTTY to true and pre-feeding an answer via a stdin mock.
    const stdinStub = makeStdinStub('y\n')
    const origStdin = Object.getOwnPropertyDescriptor(process, 'stdin')
    Object.defineProperty(process, 'stdin', { configurable: true, value: stdinStub })
    const symlinkSpy = vi.spyOn(fs, 'symlink').mockImplementation(async () => {
      throw Object.assign(new Error('EPERM: simulated'), { code: 'EPERM' })
    })
    try {
      const r = await runCapturing(async () => {
        const out = await maybeOfferAgentsLink({
          projectRoot,
          dryRun: false,
          format: 'human',
        })
        expect(out.action).toBe('failed')
        expect(out.error).toContain('EPERM')
      })
      // Sanity: prompt was written to (captured) stdout, not the test runner's.
      expect(r.stdout).toContain('AGENTS.md')
    } finally {
      symlinkSpy.mockRestore()
      if (origStdin) Object.defineProperty(process, 'stdin', origStdin)
    }
  })

  it('treats a broken symlink at AGENTS.md as "exists, do nothing"', async () => {
    // lstat (used by the impl) sees the link itself, so even a dangling link counts as present.
    await fs.writeFile(join(projectRoot, 'CLAUDE.md'), '# C\n')
    await fs.symlink('does-not-exist.md', join(projectRoot, 'AGENTS.md'))
    const r = await maybeOfferAgentsLink({ projectRoot, dryRun: false, format: 'json' })
    expect(r.action).toBe('none')
    expect(r.agentsMdExists).toBe(true)
  })
})

// ----- runInstallSkills: fs-version marker integration -----

describe('runInstallSkills — fsVersion marker', () => {
  let projectRoot: string

  beforeEach(async () => {
    projectRoot = await fs.mkdtemp(join(tmpdir(), 'memon-fs-version-install-'))
  })
  afterEach(async () => {
    await fs.rm(projectRoot, { recursive: true, force: true })
  })

  async function runJson(opts: { agents?: AgentName[]; target?: string; dryRun?: boolean } = {}) {
    return runCapturing(async () => {
      await runInstallSkills({
        projectRoot: opts.target ? undefined : projectRoot,
        cwd: projectRoot,
        format: 'json',
        agents: opts.agents,
        target: opts.target,
        dryRun: opts.dryRun,
      })
    })
  }

  it('first install creates marker with current version + null last_migrated_at + ISO8601 installed_at', async () => {
    const r = await runJson()
    expect(r.exitCode).toBeNull()
    const json = JSON.parse(r.stdout)
    expect(json.fsVersion.status).toBe('uninitialised')
    expect(json.fsVersion.current).toBeNull()
    expect(json.fsVersion.available).toBeGreaterThanOrEqual(1)
    expect(json.fsVersion.upgradeRequired).toBe(false)
    expect(typeof json.fsVersion.writtenAt).toBe('string')
    // ISO8601 with offset
    expect(json.fsVersion.writtenAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?([+-]\d{2}:\d{2}|Z)$/,
    )

    const onDisk = JSON.parse(await fs.readFile(join(projectRoot, '.memon/version.json'), 'utf8'))
    expect(onDisk.fs_convention_version).toBe(json.fsVersion.available)
    expect(onDisk.last_migrated_at).toBeNull()
    expect(typeof onDisk.installed_at).toBe('string')
  })

  it('re-install on matching version preserves bytes (mtime unchanged)', async () => {
    await runJson()
    const markerPath = join(projectRoot, '.memon/version.json')
    const before = await fs.stat(markerPath)
    const beforeContent = await fs.readFile(markerPath, 'utf8')
    // wait briefly so a re-write would change mtime
    await new Promise((r) => setTimeout(r, 10))
    const r = await runJson()
    const after = await fs.stat(markerPath)
    const afterContent = await fs.readFile(markerPath, 'utf8')
    expect(afterContent).toBe(beforeContent)
    expect(after.mtimeMs).toBe(before.mtimeMs)
    const json = JSON.parse(r.stdout)
    expect(json.fsVersion.status).toBe('match')
    expect(json.fsVersion.writtenAt).toBeNull()
  })

  it('ahead version exits 11 (MEMON_TOO_OLD) and does NOT write skill files', async () => {
    // Pre-seed an "ahead" marker.
    await fs.mkdir(join(projectRoot, '.memon'), { recursive: true })
    await fs.writeFile(
      join(projectRoot, '.memon/version.json'),
      JSON.stringify({
        fs_convention_version: 9999,
        installed_at: '2026-05-04T10:00:00+08:00',
        last_migrated_at: null,
      }),
    )
    const r = await runJson()
    expect(r.exitCode).toBe(11)
    expect(r.stderr).toContain('MEMON_TOO_OLD')
    // No skill files should have been written to the agent dirs.
    for (const sub of Object.values(AGENT_TARGETS)) {
      expect(await dirExists(join(projectRoot, sub))).toBe(false)
    }
  })

  it('--target path emits fsVersion: null and creates no .memon/ dir', async () => {
    const explicit = join(projectRoot, 'custom', 'skills')
    const r = await runJson({ target: explicit })
    const json = JSON.parse(r.stdout)
    expect(json.fsVersion).toBeNull()
    expect(await dirExists(join(projectRoot, '.memon'))).toBe(false)
  })

  it('dry-run does not write the marker even on first install', async () => {
    const r = await runJson({ dryRun: true })
    const json = JSON.parse(r.stdout)
    expect(json.fsVersion.status).toBe('uninitialised')
    expect(json.fsVersion.writtenAt).toBeNull()
    expect(await dirExists(join(projectRoot, '.memon'))).toBe(false)
  })
})

// ----- helpers -----

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await fs.stat(p)
    return s.isDirectory()
  } catch {
    return false
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.lstat(p)
    return true
  } catch {
    return false
  }
}

/**
 * Minimal stdin stub: feeds a fixed line to the first 'data' listener and
 * reports `isTTY: true` so the prompt path runs.
 */
function makeStdinStub(line: string) {
  const listeners: Record<string, ((arg?: unknown) => void)[]> = {}
  const stub = {
    isTTY: true as const,
    on(event: string, cb: (arg?: unknown) => void) {
      const callbacks = listeners[event] ?? []
      listeners[event] = callbacks
      callbacks.push(cb)
      if (event === 'data') {
        // Fire synchronously on next microtask
        Promise.resolve().then(() => cb(Buffer.from(line, 'utf8')))
      }
      return stub
    },
    removeListener(event: string, cb: (arg?: unknown) => void) {
      if (!listeners[event]) return stub
      listeners[event] = listeners[event].filter((l) => l !== cb)
      return stub
    },
  }
  return stub
}
