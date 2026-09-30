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
import { DEFAULT_FILE_ACCESS_OPTIONS, type FileAccessOptions } from '../project-file-store.js'
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
  type GitStatusConfig,
  MIN_GIT_STATUS_INTERVAL_MS,
  type PollConfig,
  type ProjectConfig,
  type SlurmConfig,
} from '../types.js'
import { BackendUrlPolicyError, normalizeBackendBaseUrl } from './backend-url.js'
import { assertOwnerOnlyServiceConfig } from './permissions.js'

const LEGACY_TELEGRAM_CONFIG_WARNING =
  'memon: warning: config key `telegram` is no longer supported; remove the `telegram:` block and delete its stored credentials.\n'
const LEGACY_INTERACTIVE_CONFIG_WARNING =
  'memon: warning: config keys `terminal`, `tmux`, and `herdr` are no longer supported and are ignored.\n'

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
  const rawRecord: Record<string, unknown> =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {}
  const hasLegacyInteractiveConfig = ['terminal', 'tmux', 'herdr'].some((key) =>
    Object.hasOwn(rawRecord, key),
  )
  if (hasLegacyInteractiveConfig) process.stderr.write(LEGACY_INTERACTIVE_CONFIG_WARNING)

  const validated = ConfigRawSchema.safeParse(raw)
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ConfigError(`invalid config: ${issues}`, candidate)
  }

  const baseDir = dirname(resolve(candidate))
  const cfg = validated.data

  // A Project that names a Host namespace makes the instance host-qualified.
  // Execution defaults are role-dependent and resolved after role selection.
  const projects: ProjectConfig[] = cfg.projects.map((p) => {
    const root = isAbsolute(p.root) ? p.root : resolve(baseDir, p.root)
    const storage = p.storage ?? 'local'
    const storageGroup = p.storage_group ?? p.storageGroup
    const readOnly = p.read_only ?? p.readOnly
    if (storage === 'local') {
      // Both keys only describe SSHFS mechanics. Accepting them silently on a
      // direct Project would promise scheduling and persistence that mode
      // deliberately does not perform.
      const sshfsOnly =
        p.storage_group !== undefined
          ? 'storage_group'
          : p.storageGroup !== undefined
            ? 'storageGroup'
            : p.persistent_cache === true
              ? 'persistent_cache'
              : undefined
      if (sshfsOnly !== undefined) {
        throw new ConfigError(
          `projects.${p.name}: \`${sshfsOnly}\` applies to \`storage: sshfs\` Projects only; project ${JSON.stringify(p.name)} reads its files directly`,
          candidate,
        )
      }
    }
    return {
      name: p.name,
      root,
      include: p.include ?? [],
      exclude: p.exclude ?? [],
      ...(p.host ? { host: p.host } : {}),
      // Always explicit on a resolved Project: the default is a policy, and
      // every consumer routes file access on it.
      storage,
      // Either spelling is accepted; the schema rejects supplying both.
      ...(storageGroup === undefined ? {} : { storageGroup }),
      ...(readOnly === undefined ? {} : { readOnly }),
      ...(p.persistent_cache === undefined ? {} : { persistentCache: p.persistent_cache }),
      ...(p.execution
        ? {
            execution:
              p.execution.kind === 'local'
                ? {
                    kind: 'local' as const,
                    ...(p.execution.python === undefined ? {} : { python: p.execution.python }),
                    ...(p.execution.component_timeout_ms === undefined
                      ? {}
                      : { component_timeout_ms: p.execution.component_timeout_ms }),
                  }
                : {
                    kind: 'ssh' as const,
                    target: p.execution.target,
                    // Remote roots are absolute on the remote machine and are
                    // never resolved against a local mount path.
                    remoteRoot: p.execution.remote_root,
                    ...(p.execution.port === undefined ? {} : { port: p.execution.port }),
                    ...(p.execution.identity_file
                      ? {
                          identityFile: isAbsolute(p.execution.identity_file)
                            ? p.execution.identity_file
                            : resolve(baseDir, p.execution.identity_file),
                        }
                      : {}),
                    ...(p.execution.known_hosts_file
                      ? {
                          knownHostsFile: isAbsolute(p.execution.known_hosts_file)
                            ? p.execution.known_hosts_file
                            : resolve(baseDir, p.execution.known_hosts_file),
                        }
                      : {}),
                  },
          }
        : {}),
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

  const duplicateProject = duplicateValue(projects.map((p) => `${p.host ?? ''}/${p.name}`))
  if (duplicateProject) {
    throw new ConfigError(
      `projects has a duplicate Project identity: ${duplicateProject}`,
      candidate,
    )
  }

  const hostQualifiedProjects = projects.filter((p) => p.host !== undefined)
  if (hostQualifiedProjects.length > 0 && hostQualifiedProjects.length !== projects.length) {
    throw new ConfigError(
      'projects must either all declare `host:` (host-qualified identity) or none of them (project-only identity)',
      candidate,
    )
  }
  /**
   * Host-qualified Projects served directly from this instance's own
   * filesystem (ordinary directories or mounts). Such an instance is the
   * central Web role by construction: it answers host-qualified routes without
   * any peer Backend, service token, or availability probe.
   */
  const directProjects = hostQualifiedProjects.length > 0

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

  // `poll` is the retired whole-project scanner; the direct central role never
  // runs it. The remaining keys stay cluster-local for a Backend-fronted
  // central, but a direct central owns the same local capabilities a
  // standalone instance does.
  const clusterOnlyKeys = ['poll', 'slurm', 'git_status'] as const

  let central: CentralConfig | undefined
  if (cfg.central || directProjects) {
    if (cfg.backend) {
      throw new ConfigError(
        'backend role must not declare per-project `host:`; the Host namespace comes from `backend.host_id`',
        candidate,
      )
    }
    if (projects.length > 0 && !directProjects) {
      throw new ConfigError(
        'central role must not define local `projects:` without a `host:` namespace; add `host:` to serve them directly or register an explicit Backend',
        candidate,
      )
    }
    if ((cfg.central?.hosts.length ?? 0) === 0 && projects.length === 0) {
      throw new ConfigError(
        'central role must define either `central.hosts` or host-qualified `projects:`',
        candidate,
      )
    }
    const incompatibleKey = (directProjects ? (['poll'] as const) : clusterOnlyKeys).find((key) =>
      Object.hasOwn(rawRecord, key),
    )
    if (incompatibleKey) {
      throw new ConfigError(
        directProjects
          ? `central role serving Projects directly must not define \`${incompatibleKey}:\`; file access is scheduled by \`fileAccess:\``
          : `central role must not define cluster-local \`${incompatibleKey}:\` settings`,
        candidate,
      )
    }

    const hosts: CentralHostConfig[] = (cfg.central?.hosts ?? []).map((host, index) => {
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
    const legacyShareHost = cfg.central?.legacy_share_host
    if (legacyShareHost && !hosts.some((host) => host.id === legacyShareHost)) {
      throw new ConfigError('central.legacy_share_host must name one configured Host', candidate)
    }

    const centralBindPort = cfg.central?.bind_port ?? DEFAULT_CENTRAL_BIND_PORT
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

    // Host ids must be unique across peer Backends and directly served
    // Projects: one Host namespace resolves to exactly one source.
    const collidingHost = hostQualifiedProjects.find((project) =>
      hosts.some((host) => host.id === project.host),
    )
    if (collidingHost) {
      throw new ConfigError(
        `Host ${JSON.stringify(collidingHost.host)} is both a registered Backend and a directly served Project namespace`,
        candidate,
      )
    }

    central = {
      bindAddr: cfg.central?.bind_addr ?? DEFAULT_CENTRAL_BIND_ADDR,
      bindPort: centralBindPort,
      ...(cfg.central?.public_url ? { publicUrl: cfg.central.public_url } : {}),
      ...(legacyShareHost ? { legacyShareHost } : {}),
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

  // Execution context. A project-only instance (standalone CLI/web or a
  // Backend) keeps today's local command execution. A directly served
  // host-qualified Project must declare `execution:` explicitly, because its
  // root may be a mount of another machine where local Git/Slurm commands
  // would silently run against the wrong host.
  const resolvedProjects: ProjectConfig[] = projects.map((project) =>
    project.execution || directProjects
      ? project
      : { ...project, execution: { kind: 'local' as const } },
  )

  const fileAccess = resolveFileAccess(cfg.fileAccess, candidate)
  const fileCache = cfg.file_cache
    ? {
        dumpPath: resolve(baseDir, cfg.file_cache.dump_path),
        dumpIntervalMs: cfg.file_cache.dump_interval_seconds * 1000,
        wikiTtlMs: cfg.file_cache.wiki_ttl_seconds * 1000,
        defaultTtlMs: cfg.file_cache.default_ttl_seconds * 1000,
      }
    : undefined
  const media = cfg.media
    ? {
        ffmpeg: cfg.media.ffmpeg.includes('/')
          ? resolve(baseDir, cfg.media.ffmpeg)
          : cfg.media.ffmpeg,
      }
    : undefined
  if (!fileCache && resolvedProjects.some((project) => project.persistentCache)) {
    throw new ConfigError(
      'persistent_cache requires file_cache.dump_path in the instance config',
      candidate,
    )
  }

  return {
    projects: resolvedProjects,
    poll,
    auth,
    slurm,
    gitStatus,
    central,
    backend,
    ...(fileAccess ? { fileAccess } : {}),
    ...(fileCache ? { fileCache } : {}),
    ...(media ? { media } : {}),
    ...(cfg.fileAccessRestart ? { fileAccessRestart: cfg.fileAccessRestart } : {}),
  }
}

/**
 * Validate saved scheduler overrides against the effective (default-merged)
 * value set. The loader and the settings API enforce the same relationships,
 * so a saved file always loads back.
 */
function resolveFileAccess(
  raw: Partial<FileAccessOptions> | undefined,
  candidate: string,
): Partial<FileAccessOptions> | undefined {
  if (!raw) return undefined
  const overrides: Partial<FileAccessOptions> = {}
  for (const [key, value] of Object.entries(raw) as [keyof FileAccessOptions, unknown][]) {
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      throw new ConfigError(`fileAccess.${key} must be a finite positive number`, candidate)
    }
    overrides[key] = value
  }
  if (Object.keys(overrides).length === 0) return undefined

  const effective: FileAccessOptions = { ...DEFAULT_FILE_ACCESS_OPTIONS, ...overrides }
  const pairs: [keyof FileAccessOptions, keyof FileAccessOptions][] = [
    ['fileMinMs', 'fileMaxMs'],
    ['directoryMinMs', 'directoryMaxMs'],
    ['maintenanceMinMs', 'maintenanceMaxMs'],
    ['failureMinMs', 'failureMaxMs'],
  ]
  for (const [min, max] of pairs) {
    if (effective[max] < effective[min]) {
      throw new ConfigError(
        `fileAccess.${max} (${effective[max]}) must be >= fileAccess.${min} (${effective[min]})`,
        candidate,
      )
    }
  }
  if (effective.leaseMs < 3 * effective.heartbeatMs) {
    throw new ConfigError(
      `fileAccess.leaseMs (${effective.leaseMs}) must tolerate at least two missed heartbeats (>= ${3 * effective.heartbeatMs})`,
      candidate,
    )
  }
  if (effective.backoffFactor <= 1) {
    throw new ConfigError(
      `fileAccess.backoffFactor (${effective.backoffFactor}) must be > 1 to back off`,
      candidate,
    )
  }
  return overrides
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
        storage: 'local',
        execution: { kind: 'local' },
      },
    ],
    poll: { ...DEFAULT_POLL },
    slurm: { ...DEFAULT_SLURM },
    gitStatus: { ...DEFAULT_GIT_STATUS },
  }
}
