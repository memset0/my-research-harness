// Read one Project's layout keys from a central `config.yml`, for
// `memon project init|lint --from-central`.
//
// Only the named `projects[]` entry is needed, so this parses the YAML and
// validates that entry with the central Project schema, without the
// instance-role checks of `loadConfig` (owner-only permissions, Host
// registries, …). `github` paths stay exactly as written (relative to the
// project root), ready to be copied into `.memon/project.yml`.

import { promises as fs } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import yaml from 'js-yaml'
import type { CentralLayoutValues } from '../project-declaration/layout.js'
import { PROJECT_LAYOUT_KEYS, ProjectConfigRawSchema } from '../schemas.js'
import { ConfigError } from './load.js'

export interface CentralProjectLayout {
  /** Absolute path of the configuration that was read. */
  configPath: string
  name: string
  host?: string
  /** The entry's `root`, resolved against the configuration's directory. */
  root: string
  /** Layout keys the entry sets (non-empty lists only). */
  layout: CentralLayoutValues
}

export async function readCentralProjectLayout(options: {
  configPath: string
  cwd: string
  project: string
  host?: string | undefined
}): Promise<CentralProjectLayout> {
  const configPath = isAbsolute(options.configPath)
    ? options.configPath
    : resolve(options.cwd, options.configPath)
  let raw: unknown
  try {
    raw = yaml.load(await fs.readFile(configPath, 'utf8'), { schema: yaml.JSON_SCHEMA })
  } catch (error) {
    throw new ConfigError(`cannot read central config: ${(error as Error).message}`, configPath)
  }
  const projects =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>).projects
      : undefined
  if (!Array.isArray(projects)) {
    throw new ConfigError('central config has no `projects:` list', configPath)
  }
  const matches = projects.filter(
    (entry): entry is Record<string, unknown> =>
      entry !== null &&
      typeof entry === 'object' &&
      (entry as Record<string, unknown>).name === options.project &&
      (options.host === undefined || (entry as Record<string, unknown>).host === options.host),
  )
  if (matches.length === 0) {
    throw new ConfigError(
      `central config has no project ${JSON.stringify(options.project)}${options.host ? ` on host ${JSON.stringify(options.host)}` : ''}`,
      configPath,
    )
  }
  if (matches.length > 1) {
    throw new ConfigError(
      `project ${JSON.stringify(options.project)} is ambiguous across hosts; pass --host`,
      configPath,
    )
  }
  const parsed = ProjectConfigRawSchema.safeParse(matches[0])
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(entry)'}: ${issue.message}`)
      .join('; ')
    throw new ConfigError(
      `invalid project ${JSON.stringify(options.project)}: ${issues}`,
      configPath,
    )
  }
  const entry = parsed.data
  const layout: CentralLayoutValues = {}
  for (const key of PROJECT_LAYOUT_KEYS) {
    const value = entry[key]
    if (value === undefined || value.length === 0) continue
    if (key === 'github')
      layout.github = entry.github!.map(({ owner, repo, path }) => ({ owner, repo, path }))
    else layout[key] = [...(value as string[])]
  }
  const baseDir = resolve(configPath, '..')
  return {
    configPath,
    name: entry.name,
    ...(entry.host ? { host: entry.host } : {}),
    root: isAbsolute(entry.root) ? entry.root : resolve(baseDir, entry.root),
    layout,
  }
}
