import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import yaml from 'js-yaml'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ConfigRawSchema } from '../schemas.js'
import { ConfigError, implicitCwdProject, loadConfig } from './load.js'
import { isProtectedExampleConfigPath } from './path-policy.js'

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

describe('persistent file cache config', () => {
  it('requires an explicit instance dump when any project opts in', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: alpha, root: ./alpha, persistent_cache: true }]\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('resolves the dump beside the selected config rather than the caller cwd', async () => {
    const configPath = join(dir, 'instance.yml')
    await fs.writeFile(configPath, 'projects: [{ name: alpha, root: ./alpha, persistent_cache: true }]\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n  dump_interval_seconds: 12.5\n  wiki_ttl_seconds: 45\n  default_ttl_seconds: 2400\n')
    const config = await loadConfig({ cwd: '/', explicitPath: configPath })
    expect(config?.fileCache?.dumpPath).toBe(join(dir, '.memon-cache', 'files.dump'))
    expect(config?.fileCache?.dumpIntervalMs).toBe(12_500)
    expect(config?.fileCache?.wikiTtlMs).toBe(45_000)
    expect(config?.fileCache?.defaultTtlMs).toBe(2_400_000)
    expect(config?.projects[0]?.persistentCache).toBe(true)
  })

  it('defaults the periodic dump interval to 30 seconds', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n')
    const config = await loadConfig({ cwd: dir })
    expect(config?.fileCache?.dumpIntervalMs).toBe(30_000)
  })

  it('rejects the removed database key rather than treating it as a dump path', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  database: ./.memon-cache/files.sqlite\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a blank dump path', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  dump_path: "   "\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a non-positive or non-finite dump interval', async () => {
    const configPath = join(dir, 'config.yml')
    await fs.writeFile(configPath, 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n  dump_interval_seconds: 0\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
    await fs.writeFile(configPath, 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n  dump_interval_seconds: .inf\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('rejects a Wiki period longer than the ordinary-document period', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: [{ name: alpha, root: ./alpha }]\nfile_cache:\n  dump_path: ./.memon-cache/files.dump\n  wiki_ttl_seconds: 1800\n  default_ttl_seconds: 30\n')
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })
})

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

describe('loadConfig central/backend role blocks', () => {
  const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const TOKEN_A_NEXT = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
  const TOKEN_B = 'cccccccccccccccccccccccccccccccc'

  async function writeProtectedInstance(
    yaml: string,
    path = join(dir, 'config.yml'),
  ): Promise<void> {
    await fs.writeFile(path, yaml, { mode: 0o600 })
    await fs.chmod(path, 0o600)
  }

  it('parses url and ssh Hosts, token rotation, and operations hints', async () => {
    const yaml = `
central:
  public_url: https://central.example.test
  hosts:
    - id: host-a
      label: Synthetic A
      tokens:
        current: ${TOKEN_A}
        next: ${TOKEN_A_NEXT}
      transport:
        kind: url
        base_url: https://backend-a.example.test
      operations:
        ssh_target: operator@host-a.example.test
        checkout_path: ./checkouts/host-a
        config_path: ./instances/host-a.yml
        runtime_bootstrap: [memon, backend, daemon, start]
        supervisor_mode: supervised
    - id: host-b
      tokens:
        current: ${TOKEN_B}
      transport:
        kind: ssh
        target: tunnel@host-b.example.test
        known_hosts_file: ./secrets/known_hosts
        identity_file: ./secrets/id_host_b
        local_port: 4738
        remote_port: 3738
`
    await writeProtectedInstance(yaml)
    const cfg = await loadConfig({ cwd: dir })

    expect(cfg!.projects).toEqual([])
    expect(cfg!.backend).toBeUndefined()
    expect(cfg!.central).toEqual({
      bindAddr: '127.0.0.1',
      bindPort: 3737,
      publicUrl: 'https://central.example.test',
      hosts: [
        {
          id: 'host-a',
          label: 'Synthetic A',
          tokens: { current: TOKEN_A, next: TOKEN_A_NEXT },
          transport: {
            kind: 'url',
            baseUrl: 'https://backend-a.example.test',
            allowInsecureHttp: false,
          },
          operations: {
            sshTarget: 'operator@host-a.example.test',
            checkoutPath: resolve(dir, 'checkouts/host-a'),
            configPath: resolve(dir, 'instances/host-a.yml'),
            runtimeBootstrap: ['memon', 'backend', 'daemon', 'start'],
            supervisorMode: 'supervised',
          },
        },
        {
          id: 'host-b',
          tokens: { current: TOKEN_B },
          transport: {
            kind: 'ssh',
            executable: 'ssh',
            target: 'tunnel@host-b.example.test',
            knownHostsFile: resolve(dir, 'secrets/known_hosts'),
            identityFile: resolve(dir, 'secrets/id_host_b'),
            localPort: 4738,
            remoteHost: '127.0.0.1',
            remotePort: 3738,
          },
        },
      ],
    })
  })

  it('allows explicit plain HTTP only with the insecure opt-in', async () => {
    const yaml = `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport:
        kind: url
        base_url: http://127.0.0.1:4738
        allow_insecure_http: true
`
    await writeProtectedInstance(yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.central!.hosts[0]!.transport).toEqual({
      kind: 'url',
      baseUrl: 'http://127.0.0.1:4738',
      allowInsecureHttp: true,
    })
  })

  it.each([
    ['http://8.8.8.8:4738', true],
    ['http://backend.internal:4738', true],
    ['https://169.254.169.254:4738', false],
  ])('rejects an unsafe Backend URL transport target %s', async (baseUrl, allowInsecure) => {
    const yaml = `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport:
        kind: url
        base_url: ${baseUrl}
        allow_insecure_http: ${allowInsecure}
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
  })

  it('parses Backend bind, rotation tokens, daemon paths, and start guards', async () => {
    const yaml = `
projects:
  - { name: project-a, root: ./project-a }
backend:
  host_id: host-a
  bind_port: 4738
  tokens:
    current: ${TOKEN_A}
    next: ${TOKEN_A_NEXT}
  daemon:
    mode: external
    state_dir: ./state
    release_dir: ./releases
    runtime_dir: ./run
    guards:
      allowed_hostnames: [login-*.example.test]
      forbidden_env: [SLURM_JOB_ID, PBS_JOBID]
    restart_argv: [service-wrapper, restart]
`
    await writeProtectedInstance(yaml)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.central).toBeUndefined()
    expect(cfg!.backend).toEqual({
      hostId: 'host-a',
      bindAddr: '127.0.0.1',
      bindPort: 4738,
      accessMode: 'read_write',
      tokens: { current: TOKEN_A, next: TOKEN_A_NEXT },
      daemon: {
        mode: 'external',
        stateDir: resolve(dir, 'state'),
        releaseDir: resolve(dir, 'releases'),
        runtimeDir: resolve(dir, 'run'),
        guards: {
          allowedHostnamePatterns: ['login-*.example.test'],
          forbiddenEnvironment: ['SLURM_JOB_ID', 'PBS_JOBID'],
        },
        restartArgv: ['service-wrapper', 'restart'],
      },
    })
  })

  it('parses explicit Backend read_only while preserving read_write default', async () => {
    const source = `
projects: [{ name: project-a, root: ./project-a }]
backend:
  host_id: host-a
  access_mode: read_only
  tokens: { current: ${TOKEN_A} }
  daemon: { state_dir: ./state, release_dir: ./releases, runtime_dir: ./run }
`
    await fs.writeFile(join(dir, 'config.yml'), source, { mode: 0o600 })
    await fs.chmod(join(dir, 'config.yml'), 0o600)
    expect((await loadConfig({ cwd: dir }))?.backend?.accessMode).toBe('read_only')
  })

  it('preserves standalone when neither role block is present', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const cfg = await loadConfig({ cwd: dir })
    expect(cfg!.central).toBeUndefined()
    expect(cfg!.backend).toBeUndefined()
    expect(cfg!.projects).toHaveLength(2)
  })

  it('rejects unsafe service config permissions without echoing tokens', async () => {
    const yaml = `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport: { kind: url, base_url: https://a.example.test }
`
    await fs.writeFile(join(dir, 'config.yml'), yaml, { mode: 0o644 })
    await fs.chmod(join(dir, 'config.yml'), 0o644)

    let error: unknown
    try {
      await loadConfig({ cwd: dir })
    } catch (caught) {
      error = caught
    }
    expect(error).toBeInstanceOf(ConfigError)
    expect(String(error)).toContain('mode must be 0600')
    expect(String(error)).not.toContain(TOKEN_A)
  })

  it('rejects a service config symlink but leaves ordinary standalone permissions unchanged', async () => {
    const protectedTarget = join(dir, 'central-target.yml')
    const central = `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport: { kind: url, base_url: https://a.example.test }
`
    await writeProtectedInstance(central, protectedTarget)
    const link = join(dir, 'central-link.yml')
    await fs.symlink(protectedTarget, link)
    await expect(loadConfig({ cwd: dir, explicitPath: link })).rejects.toMatchObject({
      message: expect.stringContaining('regular non-symlink file'),
    })

    const standaloneDir = join(dir, 'ordinary-standalone')
    await fs.mkdir(standaloneDir, { mode: 0o755 })
    await fs.chmod(standaloneDir, 0o755)
    const standalonePath = join(standaloneDir, 'config.yml')
    await fs.writeFile(standalonePath, VALID, { mode: 0o644 })
    await fs.chmod(standalonePath, 0o644)
    await expect(
      loadConfig({ cwd: standaloneDir, explicitPath: standalonePath }),
    ).resolves.toMatchObject({ projects: expect.any(Array) })
  })

  it('rejects central and backend together', async () => {
    const yaml = `
projects:
  - { name: project-a, root: ./project-a }
central: { hosts: [] }
backend:
  host_id: host-a
  tokens: { current: ${TOKEN_A} }
  daemon:
    state_dir: ./state
    release_dir: ./releases
    runtime_dir: ./run
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('mutually exclusive'),
    })
  })

  it.each(['hub', 'node'])('rejects the legacy %s role with a migration error', async (role) => {
    await fs.writeFile(join(dir, 'config.yml'), `${role}: {}\n`)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining(`legacy \`${role}:\` role configuration`),
    })
  })

  it('rejects duplicate Host IDs, tokens, and SSH local ports', async () => {
    const cases = [
      `
central:
  hosts:
    - { id: host-a, tokens: { current: ${TOKEN_A} }, transport: { kind: url, base_url: https://a.example.test } }
    - { id: host-a, tokens: { current: ${TOKEN_B} }, transport: { kind: url, base_url: https://b.example.test } }
`,
      `
central:
  hosts:
    - { id: host-a, tokens: { current: ${TOKEN_A} }, transport: { kind: url, base_url: https://a.example.test } }
    - { id: host-b, tokens: { current: ${TOKEN_A} }, transport: { kind: url, base_url: https://b.example.test } }
`,
      `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport: { kind: ssh, target: a.example.test, known_hosts_file: ./known, local_port: 4738, remote_port: 3738 }
    - id: host-b
      tokens: { current: ${TOKEN_B} }
      transport: { kind: ssh, target: b.example.test, known_hosts_file: ./known, local_port: 4738, remote_port: 3738 }
`,
    ]
    for (const yaml of cases) {
      await fs.writeFile(join(dir, 'config.yml'), yaml)
      await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
    }
  })

  it('accepts only a configured Host as the legacy share migration target', async () => {
    const valid = `
central:
  legacy_share_host: host-a
  hosts:
    - { id: host-a, tokens: { current: ${TOKEN_A} }, transport: { kind: url, base_url: https://a.example.test } }
`
    await fs.writeFile(join(dir, 'config.yml'), valid, { mode: 0o600 })
    await fs.chmod(join(dir, 'config.yml'), 0o600)
    expect((await loadConfig({ cwd: dir }))?.central?.legacyShareHost).toBe('host-a')

    await fs.writeFile(
      join(dir, 'config.yml'),
      valid.replace('legacy_share_host: host-a', 'legacy_share_host: missing'),
      { mode: 0o600 },
    )
    await expect(loadConfig({ cwd: dir })).rejects.toThrow(/must name one configured Host/)
  })

  it('rejects invalid rotation, URL, role fields, guards, and restart argv', async () => {
    const cases = [
      `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A}, next: ${TOKEN_A} }
      transport: { kind: url, base_url: https://a.example.test }
`,
      `
central:
  hosts:
    - id: host-a
      tokens: { current: ${TOKEN_A} }
      transport: { kind: url, base_url: http://127.0.0.1:4738 }
`,
      `
projects: [{ name: project-a, root: ./project-a }]
central: { hosts: [] }
`,
      `
projects: [{ name: project-a, root: ./project-a }]
auth: { password: human-secret }
backend:
  host_id: host-a
  tokens: { current: ${TOKEN_A} }
  daemon: { state_dir: ./state, release_dir: ./releases, runtime_dir: ./run }
`,
      `
projects: [{ name: project-a, root: ./project-a }]
backend:
  host_id: host-a
  tokens: { current: ${TOKEN_A} }
  daemon:
    state_dir: ./state
    release_dir: ./releases
    runtime_dir: ./run
    guards: { forbidden_env: [NOT-AN-ENV] }
`,
      `
projects: [{ name: project-a, root: ./project-a }]
backend:
  host_id: host-a
  tokens: { current: ${TOKEN_A} }
  daemon:
    mode: supervised
    state_dir: ./state
    release_dir: ./releases
    runtime_dir: ./run
    restart_argv: [service-wrapper, restart]
`,
    ]
    for (const yaml of cases) {
      await fs.writeFile(join(dir, 'config.yml'), yaml)
      await expect(loadConfig({ cwd: dir })).rejects.toBeInstanceOf(ConfigError)
    }
  })

  it('rejects missing Projects outside central mode', async () => {
    await fs.writeFile(join(dir, 'config.yml'), 'projects: []\n')
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('at least one project'),
    })

    const backend = `
backend:
  host_id: host-a
  tokens: { current: ${TOKEN_A} }
  daemon: { state_dir: ./state, release_dir: ./releases, runtime_dir: ./run }
`
    await fs.writeFile(join(dir, 'config.yml'), backend)
    await expect(loadConfig({ cwd: dir })).rejects.toMatchObject({
      message: expect.stringContaining('at least one project'),
    })
  })
})

describe('tracked config example', () => {
  it('remains protected and parses as the synthetic standalone template', async () => {
    const examplePath = fileURLToPath(new URL('../../../../config.example.yml', import.meta.url))
    expect(isProtectedExampleConfigPath(examplePath)).toBe(true)

    const source = await fs.readFile(examplePath, 'utf8')
    const parsed = yaml.load(source, { schema: yaml.JSON_SCHEMA })
    const result = ConfigRawSchema.safeParse(parsed)
    expect(result.success).toBe(true)
    if (!result.success) return

    expect(result.data.projects.map((project) => project.name)).toEqual(['project-a', 'project-b'])
    expect(result.data.central).toBeUndefined()
    expect(result.data.backend).toBeUndefined()
    expect(Object.hasOwn(result.data, 'hub')).toBe(false)
    expect(Object.hasOwn(result.data, 'node')).toBe(false)
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

describe('loadConfig retired interactive config compatibility', () => {
  async function captureStderr<T>(run: () => Promise<T>): Promise<{ value: T; stderr: string }> {
    const original = process.stderr.write
    let stderr = ''
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      return { value: await run(), stderr }
    } finally {
      process.stderr.write = original
    }
  }

  it('accepts invalid legacy values, ignores them all, and warns once', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
terminal:
  ttyd_max_concurrent: -1
  commands:
    claude: []
tmux: definitely-not-valid
herdr:
  cli: []
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const { value: cfg, stderr } = await captureStderr(() => loadConfig({ cwd: dir }))
    expect(cfg).not.toHaveProperty('terminal')
    expect(cfg).not.toHaveProperty('tmux')
    expect(cfg).not.toHaveProperty('herdr')
    expect(stderr.match(/no longer supported/g)).toHaveLength(1)
  })
})

describe('loadConfig legacy telegram block', () => {
  async function captureStderr<T>(run: () => Promise<T>): Promise<{ value: T; stderr: string }> {
    const original = process.stderr.write
    let stderr = ''
    process.stderr.write = ((chunk: unknown) => {
      stderr += String(chunk)
      return true
    }) as typeof process.stderr.write
    try {
      return { value: await run(), stderr }
    } finally {
      process.stderr.write = original
    }
  }

  it('warns, redacts, and ignores a complete legacy block', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram:
  bot_token: "12345:ABC-DEF"
  chat_id: "-100123456"
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const { value: cfg, stderr } = await captureStderr(() => loadConfig({ cwd: dir }))
    expect(cfg).not.toBeNull()
    expect('telegram' in cfg!).toBe(false)
    expect(stderr).toContain('config key `telegram` is no longer supported')
    expect(stderr).toContain('delete its stored credentials')
    expect(stderr).not.toContain('12345:ABC-DEF')
    expect(stderr).not.toContain('-100123456')
  })

  it('warns and ignores a malformed legacy block instead of rejecting config', async () => {
    const yaml = `
projects:
  - { name: a, root: ./a }
telegram: definitely-not-an-object
`
    await fs.writeFile(join(dir, 'config.yml'), yaml)
    const { value: cfg, stderr } = await captureStderr(() => loadConfig({ cwd: dir }))
    expect(cfg).not.toBeNull()
    expect('telegram' in cfg!).toBe(false)
    expect(stderr).toContain('config key `telegram` is no longer supported')
  })

  it('does not warn when the legacy key is absent', async () => {
    await fs.writeFile(join(dir, 'config.yml'), VALID)
    const { value: cfg, stderr } = await captureStderr(() => loadConfig({ cwd: dir }))
    expect(cfg).not.toBeNull()
    expect(stderr).toBe('')
  })
})
