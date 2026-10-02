// `.memon/project.yml` — the tracked, optional project declaration.
//
//   schema_version: 1        # required, integer, only 1 is supported
//   run_dirs:                # optional, non-empty; central run_dirs rules
//     - logs/*
//     - outputs/*/*
//
// Strict: any other key, a missing or unsupported `schema_version`, or a
// document that is not a mapping is `PROJECT_DECLARATION_INVALID`. Forward
// extension happens by a new schema version or new keys in a later change,
// never by tolerating unknown keys now.

import { runDirPatternError } from '../discovery/run-dirs.js'
import { PROJECT_DECLARATION_RELPATH } from './paths.js'

export const PROJECT_DECLARATION_INVALID = 'PROJECT_DECLARATION_INVALID'
export const PROJECT_DECLARATION_SCHEMA_VERSION = 1

export interface ProjectDeclaration {
  schema_version: 1
  run_dirs?: string[]
}

const KNOWN_KEYS = new Set(['schema_version', 'run_dirs'])

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
  const declaration: ProjectDeclaration = { schema_version: 1 }
  if ('run_dirs' in record) {
    const runDirs = record.run_dirs
    if (!Array.isArray(runDirs) || runDirs.length === 0) {
      throw new ProjectDeclarationError('"run_dirs" must be a non-empty list', 'run_dirs')
    }
    for (const pattern of runDirs) {
      const error = runDirPatternError(pattern as string)
      if (error !== null) throw new ProjectDeclarationError(`run_dirs: ${error}`, 'run_dirs')
    }
    declaration.run_dirs = [...(runDirs as string[])]
  }
  return declaration
}
