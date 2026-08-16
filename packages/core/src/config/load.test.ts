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

  it('parses session_secret when present', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  username: alice
  password: secret123
  session_secret: AbCdEf0123456789-_abcdef0123456789ABCDEFGHIJ
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.auth).toEqual({
      username: 'alice',
      password: 'secret123',
      sessionSecret: 'AbCdEf0123456789-_abcdef0123456789ABCDEFGHIJ',
    })
  })

  it('rejects non-base64url session_secret', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
auth:
  password: secret123
  session_secret: "not base64url!"
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
    expect(cfg.terminal.ttydMaxConcurrent).toBe(16)
    expect(cfg.terminal.ttydIdleTtlMinutes).toBe(30)
    expect(cfg.slurm.totalNodes).toBe(-1)
  })
})

describe('loadConfig slurm block', () => {
  it('defaults to totalNodes: -1 when block is absent', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.slurm).toEqual({ totalNodes: -1 })
  })

  it('parses positive total_nodes', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
slurm:
  total_nodes: 8
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.slurm).toEqual({ totalNodes: 8 })
  })

  it('accepts the disabling sentinel -1', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
slurm:
  total_nodes: -1
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.slurm).toEqual({ totalNodes: -1 })
  })

  it('rejects total_nodes: 0', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
slurm:
  total_nodes: 0
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects total_nodes: -2', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
slurm:
  total_nodes: -2
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects non-integer total_nodes', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
slurm:
  total_nodes: 7.5
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('loadConfig git_status block', () => {
  it('defaults to intervalMs: 10000 when block is absent', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.gitStatus).toEqual({ intervalMs: 10_000 })
  })

  it('parses a custom interval_ms', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
git_status:
  interval_ms: 30000
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.gitStatus).toEqual({ intervalMs: 30_000 })
  })

  it('accepts the floor (1000)', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
git_status:
  interval_ms: 1000
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.gitStatus).toEqual({ intervalMs: 1_000 })
  })

  it('rejects interval_ms below the 1000ms floor', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
git_status:
  interval_ms: 500
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('git_status.interval_ms'),
    })
  })

  it('rejects non-integer interval_ms', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
git_status:
  interval_ms: 1500.5
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('loadConfig hub/node blocks', () => {
  it('parses a node block to camelCase with default capabilities', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
node:
  name: nvl72
  auth_token: tok-abc
  hub_url: ws://localhost:3737
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.node).toEqual({
      name: 'nvl72',
      authToken: 'tok-abc',
      hubUrl: 'ws://localhost:3737',
      capabilities: { tmux: true, projects: true },
    })
    expect(cfg!.hub).toBeUndefined()
  })

  it('honors a partial capabilities override', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
node:
  name: m2
  auth_token: t
  hub_url: ws://localhost:3737
  capabilities:
    tmux: false
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.node!.capabilities).toEqual({ tmux: false, projects: true })
  })

  it('parses a hub block with defaults and a node registry', async () => {
    const yaml = `
hub:
  public_url: wss://memon-m2.dev.mem.ac
  nodes:
    - { name: m2, auth_token: t1 }
    - { name: nvl72, auth_token: t2 }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.hub).toEqual({
      bindAddr: '127.0.0.1',
      bindPort: 3737,
      publicUrl: 'wss://memon-m2.dev.mem.ac',
      nodes: [
        { name: 'm2', authToken: 't1' },
        { name: 'nvl72', authToken: 't2' },
      ],
    })
    expect(cfg!.node).toBeUndefined()
  })

  it('allows a hub with no projects', async () => {
    const yaml = `
hub:
  nodes:
    - { name: m2, auth_token: t1 }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.hub).toBeDefined()
    expect(cfg!.projects).toHaveLength(0)
  })

  it('rejects a non-hub config with no projects', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: []\n')
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('at least one project'),
    })
  })

  it('rejects both hub and node present', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
hub:
  nodes: []
node:
  name: m2
  auth_token: t
  hub_url: ws://localhost:3737
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('mutually exclusive'),
    })
  })

  it('rejects a node block missing hub_url', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
node:
  name: m2
  auth_token: t
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a node name that is not kebab-case', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
node:
  name: NVL72
  auth_token: t
  hub_url: ws://localhost:3737
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects duplicate node names in the hub registry', async () => {
    const yaml = `
hub:
  nodes:
    - { name: m2, auth_token: t1 }
    - { name: m2, auth_token: t2 }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('duplicate node name'),
    })
  })
})

describe('loadConfig project-name regex', () => {
  it('accepts letters, digits, and hyphens', async () => {
    const yaml = `
projects:
  - { name: project-a, root: ./a }
  - { name: SparseFsdp2, root: ./b }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.projects.map((p) => p.name)).toEqual(['project-a', 'SparseFsdp2'])
  })

  it('rejects project name with a space', async () => {
    const yaml = `
projects:
  - { name: bad name, root: ./a }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('projects.0.name'),
    })
  })

  it('rejects project name with a dot', async () => {
    const yaml = `
projects:
  - { name: v1.0, root: ./a }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects project name with a slash', async () => {
    const yaml = `
projects:
  - { name: my/project, root: ./a }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('loadConfig terminal block', () => {
  const DEFAULT_COMMANDS = {
    none: [],
    claude: ['claude'],
    codex: ['codex'],
    opencode: ['opencode'],
  }

  it('applies defaults when block is absent', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal).toEqual({
      tmuxEnabled: true,
      ttydMaxConcurrent: 16,
      ttydIdleTtlMinutes: 30,
      paneInfoActivePollMs: 5_000,
      paneInfoIdlePollMs: 60_000,
      commands: DEFAULT_COMMANDS,
    })
  })

  it('partial config fills missing defaults', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_max_concurrent: 8
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal).toEqual({
      tmuxEnabled: true,
      ttydMaxConcurrent: 8,
      ttydIdleTtlMinutes: 30,
      paneInfoActivePollMs: 5_000,
      paneInfoIdlePollMs: 60_000,
      commands: DEFAULT_COMMANDS,
    })
  })

  it('idle_ttl_minutes 0 is allowed (disables killer)', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_idle_ttl_minutes: 0
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.ttydIdleTtlMinutes).toBe(0)
  })

  it('parses optional tmux enablement and Herdr CLI argv', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  tmux_enabled: false
  herdr:
    cli: ["/opt/herdr/bin/herdr", "--fixed-prefix"]
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.tmuxEnabled).toBe(false)
    expect(cfg!.terminal.herdr).toEqual({
      cli: ['/opt/herdr/bin/herdr', '--fixed-prefix'],
    })
  })

  it('rejects an empty Herdr CLI argv', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  herdr:
    cli: []
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects negative ttyd_max_concurrent', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_max_concurrent: -1
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects negative ttyd_idle_ttl_minutes', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_idle_ttl_minutes: -5
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects ttyd_max_concurrent of 0', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_max_concurrent: 0
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('honors custom pane_info polling intervals', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  pane_info_active_poll_ms: 3000
  pane_info_idle_poll_ms: 120000
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.paneInfoActivePollMs).toBe(3000)
    expect(cfg!.terminal.paneInfoIdlePollMs).toBe(120000)
  })

  it('rejects zero pane_info_active_poll_ms', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  pane_info_active_poll_ms: 0
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects pane_info_idle_poll_ms below active', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  pane_info_active_poll_ms: 5000
  pane_info_idle_poll_ms: 2000
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/must be >=/)
  })

  it('per-agent commands partial override fills the rest with defaults', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    claude: ["claude", "--model", "claude-sonnet-4-6"]
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.commands).toEqual({
      none: [],
      claude: ['claude', '--model', 'claude-sonnet-4-6'],
      codex: ['codex'],
      opencode: ['opencode'],
    })
  })

  it('per-agent commands full override uses caller values exactly', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    none: ["zsh", "-l"]
    claude: ["bash", "-lc", "exec claude"]
    codex: ["codex", "--profile", "local"]
    opencode: ["opencode"]
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.commands).toEqual({
      none: ['zsh', '-l'],
      claude: ['bash', '-lc', 'exec claude'],
      codex: ['codex', '--profile', 'local'],
      opencode: ['opencode'],
    })
  })

  it('commands.none empty array is accepted (default behaviour)', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    none: []
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.terminal.commands.none).toEqual([])
  })

  it('rejects commands.claude empty array', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    claude: []
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects commands.claude with empty-string element', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    claude: ["", "--continue"]
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects commands with unknown agent key', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  commands:
    aider: ["aider"]
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

describe('loadConfig telegram block', () => {
  it('returns telegram: undefined when block is absent', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.telegram).toBeUndefined()
  })

  it('parses a full telegram block to camelCase with defaults filled', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "12345:ABC-DEF"
  chat_id: "-100123456"
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.telegram).toEqual({
      botToken: '12345:ABC-DEF',
      chatId: '-100123456',
      parseMode: 'MarkdownV2',
      disableNotification: false,
    })
  })

  it('accepts numeric chat_id and stringifies', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "tok"
  chat_id: -100123456
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.telegram!.chatId).toBe('-100123456')
  })

  it('honours parse_mode HTML and disable_notification true', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "tok"
  chat_id: "1"
  parse_mode: HTML
  disable_notification: true
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.telegram!.parseMode).toBe('HTML')
    expect(cfg!.telegram!.disableNotification).toBe(true)
  })

  it('rejects block missing bot_token', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  chat_id: "1"
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects block missing chat_id', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "tok"
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects unsupported parse_mode like "Markdown"', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "tok"
  chat_id: "1"
  parse_mode: Markdown
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})
