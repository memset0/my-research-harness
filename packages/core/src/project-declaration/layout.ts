// Effective project layout: `run_dirs`, `include`, `exclude`, `github`.
//
// Layout belongs to the project (`.memon/project.yml`); the central Project
// entry may still carry it during the deprecation window. Each key resolves
// independently, the first present (non-empty) source winning as a whole:
//
//   1. CLI `--run-dir`                (run_dirs only)
//   2. central Project entry          (deprecated; still wins)
//   3. `.memon/project.yml`
//   4. default                        (v8 run_dirs; include all; no exclude; no github)
//
// A central key that differs from the declaration logs one
// `CENTRAL_LAYOUT_DEPRECATED` conflict warning per process, root and key.
// Run walks warn for `include`/`exclude` only: an explicit `runDirs` reaching
// discovery may be a CLI `--run-dir`, which legitimately overrides the
// declaration; `run_dirs` conflicts are reported by `memon project lint
// --from-central` (and the deprecation itself by `loadConfig`).

import { resolve } from '@memon/file-protocol/paths'
import { DEFAULT_RUN_DIRS } from '../discovery/run-dirs.js'
import { PROJECT_LAYOUT_KEYS, type ProjectLayoutKey } from '../schemas.js'
import type { GithubRepoMapping, ProjectConfig } from '../types.js'
import { loadProjectDeclaration } from './load.js'
import { PROJECT_DECLARATION_RELPATH } from './paths.js'
import {
  type DeclaredGithubMapping,
  type ProjectDeclaration,
  ProjectDeclarationError,
} from './schema.js'

export const CENTRAL_LAYOUT_DEPRECATED = 'CENTRAL_LAYOUT_DEPRECATED'

export type LayoutSourceName = 'cli' | 'central' | 'project' | 'default'

export interface ProjectLayout {
  runDirs: string[]
  include: string[]
  exclude: string[]
  /** Mappings with absolute paths (resolved against the project root). */
  github: GithubRepoMapping[]
  sources: Record<ProjectLayoutKey, LayoutSourceName>
}

/** Raw central layout values as written in `config.yml` (github paths unresolved). */
export interface CentralLayoutValues {
  run_dirs?: string[]
  include?: string[]
  exclude?: string[]
  github?: DeclaredGithubMapping[]
}

const present = <T>(value: readonly T[] | undefined): value is readonly T[] =>
  value !== undefined && value.length > 0

/** The central values a resolved `ProjectConfig` carries (empty lists count as absent). */
export function centralLayoutOf(project: ProjectConfig): {
  run_dirs?: string[]
  include?: string[]
  exclude?: string[]
  github?: GithubRepoMapping[]
} {
  return {
    ...(present(project.runDirs) ? { run_dirs: project.runDirs } : {}),
    ...(present(project.include) ? { include: project.include } : {}),
    ...(present(project.exclude) ? { exclude: project.exclude } : {}),
    ...(present(project.github) ? { github: project.github } : {}),
  }
}

/** Layout keys the central entry does not supply (so the declaration is needed). */
export function keysNeedingDeclaration(
  project: ProjectConfig,
  options: { cliRunDirs?: readonly string[] | undefined; keys?: readonly ProjectLayoutKey[] } = {},
): ProjectLayoutKey[] {
  const central = centralLayoutOf(project)
  return (options.keys ?? PROJECT_LAYOUT_KEYS).filter((key) =>
    key === 'run_dirs' && present(options.cliRunDirs) ? false : central[key] === undefined,
  )
}

function sameList(a: readonly unknown[], b: readonly unknown[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function resolveGithub(root: string, mappings: readonly DeclaredGithubMapping[]) {
  return mappings.map((mapping) => ({ ...mapping, path: resolve(root, mapping.path) }))
}

/** Per key, whether a present central value differs from the declaration's. */
export function centralLayoutConflicts(
  project: ProjectConfig,
  declaration: ProjectDeclaration | null,
): ProjectLayoutKey[] {
  if (declaration === null) return []
  const central = centralLayoutOf(project)
  const conflicts: ProjectLayoutKey[] = []
  for (const key of PROJECT_LAYOUT_KEYS) {
    const centralValue = central[key]
    const declared: readonly unknown[] | undefined = declaration[key]
    if (centralValue === undefined || !present(declared)) continue
    const comparable =
      key === 'github' && declaration.github
        ? resolveGithub(project.root, declaration.github)
        : declared
    if (!sameList(centralValue, comparable)) conflicts.push(key)
  }
  return conflicts
}

/** Pure precedence: CLI > central > declaration > default, per key. */
export function selectProjectLayout(input: {
  project: ProjectConfig
  declaration: ProjectDeclaration | null
  cliRunDirs?: readonly string[] | undefined
}): ProjectLayout {
  const { project, declaration } = input
  const central = centralLayoutOf(project)
  const sources = {} as Record<ProjectLayoutKey, LayoutSourceName>
  const pick = <T>(
    key: ProjectLayoutKey,
    centralValue: readonly T[] | undefined,
    declared: readonly T[] | undefined,
    fallback: readonly T[],
  ): T[] => {
    if (centralValue !== undefined) {
      sources[key] = 'central'
      return [...centralValue]
    }
    if (present(declared)) {
      sources[key] = 'project'
      return [...declared]
    }
    sources[key] = 'default'
    return [...fallback]
  }
  let runDirs: string[]
  if (present(input.cliRunDirs)) {
    sources.run_dirs = 'cli'
    runDirs = [...input.cliRunDirs]
  } else {
    runDirs = pick('run_dirs', central.run_dirs, declaration?.run_dirs, DEFAULT_RUN_DIRS)
  }
  const include = pick('include', central.include, declaration?.include, [])
  const exclude = pick('exclude', central.exclude, declaration?.exclude, [])
  const github = pick<GithubRepoMapping>(
    'github',
    central.github,
    declaration?.github ? resolveGithub(project.root, declaration.github) : undefined,
    [],
  )
  return { runDirs, include, exclude, github, sources }
}

const warnedConflicts = new Set<string>()

/** Log the once-per-process conflict warning for `root`/`key`. */
function warnConflicts(project: ProjectConfig, keys: readonly ProjectLayoutKey[]): void {
  for (const key of keys) {
    const id = `${project.root}\0${key}`
    if (warnedConflicts.has(id)) continue
    warnedConflicts.add(id)
    process.stderr.write(
      `memon: warning: ${CENTRAL_LAYOUT_DEPRECATED}: project ${JSON.stringify(project.name)}: central \`${key}\` conflicts with ${PROJECT_DECLARATION_RELPATH}; using the central value until it is removed from the central configuration\n`,
    )
  }
}

/** Test hook: forget which conflicts were already reported. */
export function resetCentralLayoutWarnings(): void {
  warnedConflicts.clear()
}

/**
 * Resolve the effective layout of `project`, reading `.memon/project.yml`
 * through `projectFs`. An invalid declaration throws when any requested key
 * falls through to it, and is ignored when the central entry (or the CLI)
 * supplies every requested key.
 */
export async function resolveProjectLayout(
  project: ProjectConfig,
  options: {
    cliRunDirs?: readonly string[] | undefined
    /** Keys the caller uses (default: all); only these may fail on an invalid declaration. */
    keys?: readonly ProjectLayoutKey[]
    /** Keys whose central/declaration conflict is logged (default: `keys`). */
    warnKeys?: readonly ProjectLayoutKey[]
  } = {},
): Promise<ProjectLayout> {
  const needed = keysNeedingDeclaration(project, options)
  let declaration: ProjectDeclaration | null = null
  try {
    declaration = await loadProjectDeclaration(project.root)
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError) || needed.length > 0) throw error
  }
  const relevant = new Set(options.warnKeys ?? options.keys ?? PROJECT_LAYOUT_KEYS)
  warnConflicts(
    project,
    centralLayoutConflicts(project, declaration).filter((key) => relevant.has(key)),
  )
  return selectProjectLayout({ project, declaration, cliRunDirs: options.cliRunDirs })
}
