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
  type Config,
  DEFAULT_GIT_STATUS,
  DEFAULT_NODE_CAPABILITIES,
  DEFAULT_POLL,
  DEFAULT_SLURM,
  DEFAULT_TERMINAL,
  type GitStatusConfig,
  type HubConfig,
  MIN_GIT_STATUS_INTERVAL_MS,
  type NodeConfig,
  type PollConfig,
  type ProjectConfig,
  type SlurmConfig,
  type TerminalConfig,
} from '../types.js'

const LEGACY_TELEGRAM_CONFIG_WARNING =
  'memon: warning: config key `telegram` is no longer supported; remove the `telegram:` block and delete its stored credentials.\n'

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

  // ── hub / node (mutually exclusive; openspec/changes/add-hub-node-split) ──
  if (cfg.hub && cfg.node) {
    throw new ConfigError(
      'config has both `hub:` and `node:` blocks — they are mutually exclusive (a process is either a hub or a node)',
      candidate,
    )
  }

  let hub: HubConfig | undefined
  if (cfg.hub) {
    const nodes = cfg.hub.nodes.map((n) => ({ name: n.name, authToken: n.auth_token }))
    const names = nodes.map((n) => n.name)
    const dup = names.find((n, i) => names.indexOf(n) !== i)
    if (dup) {
      throw new ConfigError(`hub.nodes has a duplicate node name: ${dup}`, candidate)
    }
    hub = {
      bindAddr: cfg.hub.bind_addr ?? '127.0.0.1',
      bindPort: cfg.hub.bind_port ?? 3737,
      nodes,
      ...(cfg.hub.public_url ? { publicUrl: cfg.hub.public_url } : {}),
    }
  }

  let node: NodeConfig | undefined
  if (cfg.node) {
    node = {
      name: cfg.node.name,
      authToken: cfg.node.auth_token,
      hubUrl: cfg.node.hub_url,
      capabilities: {
        tmux: cfg.node.capabilities?.tmux ?? DEFAULT_NODE_CAPABILITIES.tmux,
        projects: cfg.node.capabilities?.projects ?? DEFAULT_NODE_CAPABILITIES.projects,
      },
    }
  }

  // A hub has no local projects (they arrive from nodes); every other role
  // requires at least one project.
  if (!hub && projects.length === 0) {
    throw new ConfigError(
      'config must define at least one project (unless running as a hub)',
      candidate,
    )
  }

  return { projects, poll, auth, terminal, slurm, gitStatus, hub, node }
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
