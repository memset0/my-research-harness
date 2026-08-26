// Config loader.
//
// Resolution order:
//   1. options.explicitPath  (--config CLI arg)
//   2. {cwd}/config.yml      (default)
//   3. null                  (caller decides: error for `serve`, fall back to
//                              implicitCwdProject for non-serve CLI commands)
//
// Project `root` paths in the config file are resolved relative to the config
// file's own directory (so `./mock/project-a` in `<repo>/config.yml` resolves
// to `<repo>/mock/project-a`).

import { promises as fs } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { ConfigRawSchema } from '../schemas.js'
import {
  type AuthConfig,
  type BackendConfig,
  type BackendServiceTokens,
  type CentralConfig,
  type CentralHostConfig,
  type Config,
  DEFAULT_GIT_STATUS,
  DEFAULT_POLL,
  DEFAULT_SLURM,
  DEFAULT_TERMINAL,
  type GitStatusConfig,
  MIN_GIT_STATUS_INTERVAL_MS,
  type PollConfig,
  type ProjectConfig,
  type SlurmConfig,
  type TerminalConfig,
} from '../types.js'
import { BackendUrlPolicyError, normalizeBackendBaseUrl } from './backend-url.js'
import { assertOwnerOnlyServiceConfig } from './permissions.js'

const LEGACY_TELEGRAM_CONFIG_WARNING =
  'memon: warning: config key `telegram` is no longer supported; remove the `telegram:` block and delete its stored credentials.\n'

const DEFAULT_CENTRAL_BIND_ADDR = '127.0.0.1'
const DEFAULT_CENTRAL_BIND_PORT = 3737
const DEFAULT_BACKEND_BIND_ADDR = '127.0.0.1'
const DEFAULT_BACKEND_BIND_PORT = 3738

function duplicateValue(values: readonly string[]): string | undefined {
  const seen = new Set<string>()
  for (const value of values) {
    if (seen.has(value)) return value
    seen.add(value)
  }
  return undefined
}

function assertDistinctTokens(
  tokens: BackendServiceTokens,
  label: string,
  candidate: string,
): void {
  if (tokens.next !== undefined && tokens.next === tokens.current) {
    throw new ConfigError(`${label}.tokens.next must differ from tokens.current`, candidate)
  }
}

function parseBackendBaseUrl(
  rawUrl: string,
  allowInsecureHttp: boolean,
  label: string,
  candidate: string,
): string {
  try {
    return normalizeBackendBaseUrl(rawUrl, { allowInsecureHttp })
  } catch (error) {
    if (error instanceof BackendUrlPolicyError) {
      throw new ConfigError(`${label}.base_url: ${error.message}`, candidate)
    }
    throw error
  }
}

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly path?: string,
  ) {
    super(message)
    this.name = 'ConfigError'
  }
}

export interface LoadConfigOptions {
  /** Explicit path passed via --config (absolute or relative to cwd) */
  explicitPath?: string
  /** Working directory used for default config lookup and as base for relative explicitPath */
  cwd: string
}

/**
 * Load the resolved config or `null` when no config file exists at the
 * default location and no `explicitPath` was given. Throws `ConfigError`
 * on invalid YAML / schema violations / missing explicit file.
 */
export async function loadConfig(opts: LoadConfigOptions): Promise<Config | null> {
  const candidate = opts.explicitPath
    ? isAbsolute(opts.explicitPath)
      ? opts.explicitPath
      : resolve(opts.cwd, opts.explicitPath)
    : join(opts.cwd, 'config.yml')

  let content: string
  try {
    content = await fs.readFile(candidate, 'utf8')
  } catch (err) {
    const errno = err as NodeJS.ErrnoException
    if (opts.explicitPath || errno.code !== 'ENOENT') {
      throw new ConfigError(`cannot read config: ${errno.message}`, candidate)
    }
    return null
  }

  let raw: unknown
  try {
    raw = yaml.load(content, { schema: yaml.JSON_SCHEMA })
  } catch (err) {
    throw new ConfigError(`invalid YAML: ${(err as Error).message}`, candidate)
  }

  if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
    const legacyRoles = ['hub', 'node'].filter((key) => Object.hasOwn(raw, key))
    if (legacyRoles.length > 0) {
      throw new ConfigError(
        `legacy ${legacyRoles.map((key) => `\`${key}:\``).join(' and ')} role configuration is no longer supported; migrate to mutually exclusive \`central:\` or \`backend:\` blocks`,
        candidate,
      )
    }
  }

  if (
    typeof raw === 'object' &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.hasOwn(raw, 'telegram')
  ) {
    process.stderr.write(LEGACY_TELEGRAM_CONFIG_WARNING)
  }

  const validated = ConfigRawSchema.safeParse(raw)
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ConfigError(`invalid config: ${issues}`, candidate)
  }

  const baseDir = dirname(resolve(candidate))
  const cfg = validated.data

  const projects: ProjectConfig[] = cfg.projects.map((p) => {
    const root = isAbsolute(p.root) ? p.root : resolve(baseDir, p.root)
    return {
      name: p.name,
      root,
      include: p.include ?? [],
      exclude: p.exclude ?? [],
      // Resolve each github mapping's path against the project root (absolute).
      ...(p.github
        ? {
            github: p.github.map((g) => ({
              owner: g.owner,
              repo: g.repo,
              path: resolve(root, g.path),
            })),
          }
        : {}),
    }
  })

  const poll: PollConfig = {
    minIntervalMs: cfg.poll?.min_interval_ms ?? DEFAULT_POLL.minIntervalMs,
    maxIntervalMs: cfg.poll?.max_interval_ms ?? DEFAULT_POLL.maxIntervalMs,
    backoffFactor: cfg.poll?.backoff_factor ?? DEFAULT_POLL.backoffFactor,
  }

  // Sanity: max >= min, factor > 1
  if (poll.maxIntervalMs < poll.minIntervalMs) {
    throw new ConfigError(
      `poll.max_interval_ms (${poll.maxIntervalMs}) must be >= poll.min_interval_ms (${poll.minIntervalMs})`,
      candidate,
    )
  }
  if (poll.backoffFactor <= 1) {
    throw new ConfigError(
      `poll.backoff_factor (${poll.backoffFactor}) must be > 1 to back off`,
      candidate,
    )
  }

  let auth: AuthConfig | undefined
  if (cfg.auth) {
    auth = { username: cfg.auth.username ?? 'admin', password: cfg.auth.password }
    if (cfg.auth.session_secret !== undefined) auth.sessionSecret = cfg.auth.session_secret
  }

  const cmds = cfg.terminal?.commands
  const terminal: TerminalConfig = {
    tmuxEnabled: cfg.terminal?.tmux_enabled ?? DEFAULT_TERMINAL.tmuxEnabled,
    ...(cfg.terminal?.herdr ? { herdr: { cli: cfg.terminal.herdr.cli } } : {}),
    ttydMaxConcurrent: cfg.terminal?.ttyd_max_concurrent ?? DEFAULT_TERMINAL.ttydMaxConcurrent,
    ttydIdleTtlMinutes: cfg.terminal?.ttyd_idle_ttl_minutes ?? DEFAULT_TERMINAL.ttydIdleTtlMinutes,
    paneInfoActivePollMs:
      cfg.terminal?.pane_info_active_poll_ms ?? DEFAULT_TERMINAL.paneInfoActivePollMs,
    paneInfoIdlePollMs: cfg.terminal?.pane_info_idle_poll_ms ?? DEFAULT_TERMINAL.paneInfoIdlePollMs,
    commands: {
      none: cmds?.none ?? DEFAULT_TERMINAL.commands.none,
      claude: cmds?.claude ?? DEFAULT_TERMINAL.commands.claude,
      codex: cmds?.codex ?? DEFAULT_TERMINAL.commands.codex,
      opencode: cmds?.opencode ?? DEFAULT_TERMINAL.commands.opencode,
    },
  }

  if (terminal.paneInfoIdlePollMs < terminal.paneInfoActivePollMs) {
    throw new ConfigError(
      `terminal.pane_info_idle_poll_ms (${terminal.paneInfoIdlePollMs}) must be >= terminal.pane_info_active_poll_ms (${terminal.paneInfoActivePollMs})`,
      candidate,
    )
  }

  const slurm: SlurmConfig = {
    totalNodes: cfg.slurm?.total_nodes ?? DEFAULT_SLURM.totalNodes,
  }

  if (slurm.totalNodes < -1 || slurm.totalNodes === 0) {
    throw new ConfigError(
      `slurm.total_nodes (${slurm.totalNodes}) must be -1 (disabled) or a positive integer`,
      candidate,
    )
  }

  const gitStatus: GitStatusConfig = {
    intervalMs: cfg.git_status?.interval_ms ?? DEFAULT_GIT_STATUS.intervalMs,
  }

  if (gitStatus.intervalMs < MIN_GIT_STATUS_INTERVAL_MS) {
    throw new ConfigError(
      `git_status.interval_ms (${gitStatus.intervalMs}) must be >= ${MIN_GIT_STATUS_INTERVAL_MS}`,
      candidate,
    )
  }

  // ── central / Backend roles ──
  if (cfg.central && cfg.backend) {
    throw new ConfigError(
      'config has both `central:` and `backend:` blocks — they are mutually exclusive',
      candidate,
    )
  }

  const rawRecord = raw as Record<string, unknown>
  const clusterOnlyKeys = ['poll', 'terminal', 'slurm', 'git_status'] as const

  let central: CentralConfig | undefined
  if (cfg.central) {
    if (projects.length > 0) {
      throw new ConfigError(
        'central role must not define local `projects:`; register an explicit Backend instead',
        candidate,
      )
    }
    const incompatibleKey = clusterOnlyKeys.find((key) => Object.hasOwn(rawRecord, key))
    if (incompatibleKey) {
      throw new ConfigError(
        `central role must not define cluster-local \`${incompatibleKey}:\` settings`,
        candidate,
      )
    }

    const hosts: CentralHostConfig[] = cfg.central.hosts.map((host, index) => {
      const tokens: BackendServiceTokens = {
        current: host.tokens.current,
        ...(host.tokens.next ? { next: host.tokens.next } : {}),
      }
      assertDistinctTokens(tokens, `central.hosts.${index}`, candidate)

      const transport =
        host.transport.kind === 'url'
          ? {
              kind: 'url' as const,
              baseUrl: parseBackendBaseUrl(
                host.transport.base_url,
                host.transport.allow_insecure_http ?? false,
                `central.hosts.${index}.transport`,
                candidate,
              ),
              allowInsecureHttp: host.transport.allow_insecure_http ?? false,
            }
          : {
              kind: 'ssh' as const,
              executable: host.transport.executable ?? 'ssh',
              target: host.transport.target,
              knownHostsFile: isAbsolute(host.transport.known_hosts_file)
                ? host.transport.known_hosts_file
                : resolve(baseDir, host.transport.known_hosts_file),
              ...(host.transport.identity_file
                ? {
                    identityFile: isAbsolute(host.transport.identity_file)
                      ? host.transport.identity_file
                      : resolve(baseDir, host.transport.identity_file),
                  }
                : {}),
              localPort: host.transport.local_port,
              remoteHost: host.transport.remote_host ?? '127.0.0.1',
              remotePort: host.transport.remote_port,
            }

      const operations = host.operations
        ? {
            ...(host.operations.ssh_target ? { sshTarget: host.operations.ssh_target } : {}),
            ...(host.operations.checkout_path
              ? {
                  checkoutPath: isAbsolute(host.operations.checkout_path)
                    ? host.operations.checkout_path
                    : resolve(baseDir, host.operations.checkout_path),
                }
              : {}),
            ...(host.operations.config_path
              ? {
                  configPath: isAbsolute(host.operations.config_path)
                    ? host.operations.config_path
                    : resolve(baseDir, host.operations.config_path),
                }
              : {}),
            ...(host.operations.runtime_bootstrap
              ? { runtimeBootstrap: host.operations.runtime_bootstrap }
              : {}),
            ...(host.operations.supervisor_mode
              ? { supervisorMode: host.operations.supervisor_mode }
              : {}),
          }
        : undefined

      return {
        id: host.id,
        ...(host.label ? { label: host.label } : {}),
        tokens,
        transport,
        ...(operations ? { operations } : {}),
      }
    })

    const duplicateHost = duplicateValue(hosts.map((host) => host.id))
    if (duplicateHost) {
      throw new ConfigError(`central.hosts has a duplicate Host id: ${duplicateHost}`, candidate)
    }

    const duplicateToken = duplicateValue(
      hosts.flatMap((host) => [
        host.tokens.current,
        ...(host.tokens.next ? [host.tokens.next] : []),
      ]),
    )
    if (duplicateToken) {
      throw new ConfigError(
        'central.hosts service tokens must be unique across Hosts and rotation slots',
        candidate,
      )
    }
    if (
      cfg.central.legacy_share_host &&
      !hosts.some((host) => host.id === cfg.central!.legacy_share_host)
    ) {
      throw new ConfigError('central.legacy_share_host must name one configured Host', candidate)
    }

    const centralBindPort = cfg.central.bind_port ?? DEFAULT_CENTRAL_BIND_PORT
    const sshLocalPorts = hosts.flatMap((host) =>
      host.transport.kind === 'ssh' ? [host.transport.localPort] : [],
    )
    const duplicateLocalPort = duplicateValue(sshLocalPorts.map(String))
    if (duplicateLocalPort) {
      throw new ConfigError(
        `central.hosts has a duplicate SSH local forwarding port: ${duplicateLocalPort}`,
        candidate,
      )
    }
    if (sshLocalPorts.includes(centralBindPort)) {
      throw new ConfigError(
        `central bind port ${centralBindPort} collides with an SSH local forwarding port`,
        candidate,
      )
    }

    central = {
      bindAddr: cfg.central.bind_addr ?? DEFAULT_CENTRAL_BIND_ADDR,
      bindPort: centralBindPort,
      ...(cfg.central.public_url ? { publicUrl: cfg.central.public_url } : {}),
      ...(cfg.central.legacy_share_host ? { legacyShareHost: cfg.central.legacy_share_host } : {}),
      hosts,
    }
  }

  let backend: BackendConfig | undefined
  if (cfg.backend) {
    if (cfg.auth) {
      throw new ConfigError(
        'backend role must not define browser-facing `auth:` credentials',
        candidate,
      )
    }
    if (projects.length === 0) {
      throw new ConfigError('backend role must define at least one project', candidate)
    }

    const tokens: BackendServiceTokens = {
      current: cfg.backend.tokens.current,
      ...(cfg.backend.tokens.next ? { next: cfg.backend.tokens.next } : {}),
    }
    assertDistinctTokens(tokens, 'backend', candidate)

    const stateDir = isAbsolute(cfg.backend.daemon.state_dir)
      ? cfg.backend.daemon.state_dir
      : resolve(baseDir, cfg.backend.daemon.state_dir)
    const releaseDir = isAbsolute(cfg.backend.daemon.release_dir)
      ? cfg.backend.daemon.release_dir
      : resolve(baseDir, cfg.backend.daemon.release_dir)
    const runtimeDir = isAbsolute(cfg.backend.daemon.runtime_dir)
      ? cfg.backend.daemon.runtime_dir
      : resolve(baseDir, cfg.backend.daemon.runtime_dir)
    const duplicateDaemonDir = duplicateValue([stateDir, releaseDir, runtimeDir])
    if (duplicateDaemonDir) {
      throw new ConfigError(
        'backend.daemon state_dir, release_dir, and runtime_dir must be distinct',
        candidate,
      )
    }

    const allowedHostnamePatterns = cfg.backend.daemon.guards?.allowed_hostnames ?? []
    const forbiddenEnvironment = cfg.backend.daemon.guards?.forbidden_env ?? []
    if (duplicateValue(allowedHostnamePatterns)) {
      throw new ConfigError(
        'backend.daemon.guards.allowed_hostnames entries must be unique',
        candidate,
      )
    }
    if (duplicateValue(forbiddenEnvironment)) {
      throw new ConfigError('backend.daemon.guards.forbidden_env entries must be unique', candidate)
    }

    backend = {
      hostId: cfg.backend.host_id,
      bindAddr: cfg.backend.bind_addr ?? DEFAULT_BACKEND_BIND_ADDR,
      bindPort: cfg.backend.bind_port ?? DEFAULT_BACKEND_BIND_PORT,
      accessMode: cfg.backend.access_mode ?? 'read_write',
      tokens,
      daemon: {
        mode: cfg.backend.daemon.mode ?? 'supervised',
        stateDir,
        releaseDir,
        runtimeDir,
        guards: { allowedHostnamePatterns, forbiddenEnvironment },
        ...(cfg.backend.daemon.restart_argv
          ? { restartArgv: cfg.backend.daemon.restart_argv }
          : {}),
      },
    }
  }

  // Standalone retains the existing project requirement.
  if (!central && !backend && projects.length === 0) {
    throw new ConfigError('standalone config must define at least one project', candidate)
  }

  if (central || backend) {
    try {
      await assertOwnerOnlyServiceConfig(candidate)
    } catch (error) {
      throw new ConfigError(
        `unsafe service-token instance config: ${(error as Error).message}`,
        candidate,
      )
    }
  }

  return { projects, poll, auth, terminal, slurm, gitStatus, central, backend }
}

/**
 * Build a synthetic single-project config using the working directory as the
 * project root. Used by non-`serve` CLI commands when no config file is found.
 */
export function implicitCwdProject(cwd: string, name = '(cwd)'): Config {
  // The default name '(cwd)' contains parentheses and intentionally does not
  // match the [A-Za-z0-9-]+ project-name format enforced at config-load
  // time — implicitCwdProject is for CLI display when no config file is
  // present; it bypasses the schema by construction.
  return {
    projects: [
      {
        name,
        root: resolve(cwd),
        include: [],
        exclude: [],
      },
    ],
    poll: { ...DEFAULT_POLL },
    terminal: { ...DEFAULT_TERMINAL },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  }
}
