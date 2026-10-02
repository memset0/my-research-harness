// `.memon/project.yml` — the tracked, optional project declaration.
//
//   schema_version: 1        # required, integer, only 1 is supported
//   run_dirs:                # optional, non-empty; Run pattern rules
//     - logs/*
//     - outputs/*/*
//   include: [...]           # optional; same rules as the central key
//   exclude: [...]           # optional; same rules as the central key
//   github:                  # optional; `path` relative, inside the root
//     - { owner: acme, repo: project-a, path: . }
//
// The layout keys (`run_dirs`, `include`, `exclude`, `github`) are validated
// by the schema the central Project entry uses (`ProjectLayoutRawSchema`), so
// the two sources cannot drift. Strict: any other key, a missing or
// unsupported `schema_version`, or a document that is not a mapping is
// `PROJECT_DECLARATION_INVALID`. Forward extension happens by a new schema
// version or new optional keys in a later change, never by tolerating unknown
// keys.

import { isAbsolute, posix } from 'node:path'
import { PROJECT_LAYOUT_KEYS, ProjectLayoutRawSchema } from '../schemas.js'
import { PROJECT_DECLARATION_RELPATH } from './paths.js'

export const PROJECT_DECLARATION_INVALID = 'PROJECT_DECLARATION_INVALID'
export const PROJECT_DECLARATION_SCHEMA_VERSION = 1

/** A GitHub repo -> project-relative directory mapping, as declared. */
export interface DeclaredGithubMapping {
  owner: string
  repo: string
  /** Relative to the project root; never escapes it. */
  path: string
}

export interface ProjectDeclaration {
  schema_version: 1
  run_dirs?: string[]
  include?: string[]
  exclude?: string[]
  github?: DeclaredGithubMapping[]
}

const KNOWN_KEYS = new Set<string>(['schema_version', ...PROJECT_LAYOUT_KEYS])

export class ProjectDeclarationError extends Error {
  readonly code = PROJECT_DECLARATION_INVALID
  /** Project-relative file path (always `.memon/project.yml`). */
  readonly file = PROJECT_DECLARATION_RELPATH
  constructor(
    message: string,
    /** The offending key, when one is to blame. */
    readonly key?: string,
  ) {
    super(`${PROJECT_DECLARATION_INVALID}: ${PROJECT_DECLARATION_RELPATH}: ${message}`)
    this.name = 'ProjectDeclarationError'
  }
}

/** Why a declared `github[].path` is unsafe, or null when it stays inside the root. */
export function declaredGithubPathError(path: string): string | null {
  if (path.includes('\0') || path.includes('\\')) return `"${path}" must not contain NUL or "\\"`
  if (isAbsolute(path)) return `"${path}" must be relative to the project root`
  const normalized = posix.normalize(path)
  if (normalized === '..' || normalized.startsWith('../'))
    return `"${path}" must stay inside the project root`
  return null
}

/** Validate a parsed YAML value; throws `ProjectDeclarationError`. */
export function validateProjectDeclaration(value: unknown): ProjectDeclaration {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProjectDeclarationError('the document must be a YAML mapping')
  }
  const record = value as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (!KNOWN_KEYS.has(key)) throw new ProjectDeclarationError(`unknown key "${key}"`, key)
  }
  if (!('schema_version' in record)) {
    throw new ProjectDeclarationError('"schema_version" is required', 'schema_version')
  }
  if (record.schema_version !== PROJECT_DECLARATION_SCHEMA_VERSION) {
    throw new ProjectDeclarationError(
      `"schema_version" must be ${PROJECT_DECLARATION_SCHEMA_VERSION}; got ${JSON.stringify(record.schema_version)}`,
      'schema_version',
    )
  }
  const { schema_version: _version, ...layoutRaw } = record
  // `null` (a key with no value) is not "absent": reject it like a wrong type.
  const parsed = ProjectLayoutRawSchema.safeParse(layoutRaw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!
    const key = String(issue.path[0] ?? '')
    const where = issue.path.slice(1).join('.')
    throw new ProjectDeclarationError(
      `${key}${where ? `.${where}` : ''}: ${issue.message}`,
      key || undefined,
    )
  }
  const layout = parsed.data
  const declaration: ProjectDeclaration = { schema_version: 1 }
  if (layout.run_dirs !== undefined) declaration.run_dirs = [...layout.run_dirs]
  if (layout.include !== undefined) declaration.include = [...layout.include]
  if (layout.exclude !== undefined) declaration.exclude = [...layout.exclude]
  if (layout.github !== undefined) {
    for (const mapping of layout.github) {
      const error = declaredGithubPathError(mapping.path)
      if (error !== null) throw new ProjectDeclarationError(`github: path ${error}`, 'github')
    }
    declaration.github = layout.github.map(({ owner, repo, path }) => ({ owner, repo, path }))
  }
  return declaration
}
