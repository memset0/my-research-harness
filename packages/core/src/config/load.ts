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
  DEFAULT_POLL,
  DEFAULT_TERMINAL,
  type AuthConfig,
  type Config,
  type PollConfig,
  type ProjectConfig,
  type TerminalConfig,
} from '../types.js'

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

  const validated = ConfigRawSchema.safeParse(raw)
  if (!validated.success) {
    const issues = validated.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ')
    throw new ConfigError(`invalid config: ${issues}`, candidate)
  }

  const baseDir = dirname(resolve(candidate))
  const cfg = validated.data

  const projects: ProjectConfig[] = cfg.projects.map((p) => ({
    name: p.name,
    root: isAbsolute(p.root) ? p.root : resolve(baseDir, p.root),
    include: p.include ?? [],
    exclude: p.exclude ?? [],
  }))

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

  const terminal: TerminalConfig = {
    ttydMaxConcurrent: cfg.terminal?.ttyd_max_concurrent ?? DEFAULT_TERMINAL.ttydMaxConcurrent,
    ttydIdleTtlMinutes: cfg.terminal?.ttyd_idle_ttl_minutes ?? DEFAULT_TERMINAL.ttydIdleTtlMinutes,
    paneInfoActivePollMs:
      cfg.terminal?.pane_info_active_poll_ms ?? DEFAULT_TERMINAL.paneInfoActivePollMs,
    paneInfoIdlePollMs:
      cfg.terminal?.pane_info_idle_poll_ms ?? DEFAULT_TERMINAL.paneInfoIdlePollMs,
  }

  if (terminal.paneInfoIdlePollMs < terminal.paneInfoActivePollMs) {
    throw new ConfigError(
      `terminal.pane_info_idle_poll_ms (${terminal.paneInfoIdlePollMs}) must be >= terminal.pane_info_active_poll_ms (${terminal.paneInfoActivePollMs})`,
      candidate,
    )
  }

  return { projects, poll, auth, terminal }
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
  }
}
