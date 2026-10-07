// `memon project lint`: validate `.memon/project.yml`, report the effective
// project layout with each key's source and, given the central entry's layout
// values, report every deprecated central layout key
// (`CENTRAL_LAYOUT_DEPRECATED`, warning; marked as a conflict when it differs
// from the declaration, in which case the central value wins).

import { resolve } from '@memon/file-protocol/paths'
import { PROJECT_LAYOUT_KEYS } from '../schemas.js'
import type { ProjectConfig } from '../types.js'
import {
  CENTRAL_LAYOUT_DEPRECATED,
  type CentralLayoutValues,
  centralLayoutConflicts,
  type ProjectLayout,
  selectProjectLayout,
} from './layout.js'
import { type EffectiveRunDirs, loadProjectDeclaration } from './load.js'
import { PROJECT_DECLARATION_RELPATH } from './paths.js'
import { type ProjectDeclaration, ProjectDeclarationError } from './schema.js'

export interface ProjectDeclarationDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  file: string
  field?: string
  message: string
  /** `CENTRAL_LAYOUT_DEPRECATED` only: the central value differs from the declaration. */
  conflict?: boolean
}

export interface ProjectDeclarationLint {
  /** Whether `.memon/project.yml` exists. */
  present: boolean
  /** The validated declaration (null when absent or invalid). */
  declaration: ProjectDeclaration | null
  /** Effective Run locations; null when the declaration is invalid (fail closed). */
  effective: EffectiveRunDirs | null
  /** Effective layout with per-key sources; null when the declaration is invalid. */
  layout: ProjectLayout | null
  diagnostics: ProjectDeclarationDiagnostic[]
}

/** A `ProjectConfig` carrying only the central layout values (for the resolver). */
function centralProject(root: string, central: CentralLayoutValues): ProjectConfig {
  return {
    name: '(lint)',
    root,
    include: central.include ?? [],
    exclude: central.exclude ?? [],
    ...(central.run_dirs ? { runDirs: central.run_dirs } : {}),
    ...(central.github
      ? { github: central.github.map((g) => ({ ...g, path: resolve(root, g.path) })) }
      : {}),
  }
}

/** Validate the declaration of `root` and resolve the effective layout. */
export async function lintProjectDeclaration(
  root: string,
  sources: {
    cliRunDirs?: readonly string[]
    /** @deprecated use `central.run_dirs`. */
    centralRunDirs?: readonly string[]
    /** Layout values of the central Project entry (`readCentralProjectLayout`). */
    central?: CentralLayoutValues
    /** Central configuration path, named in deprecation messages. */
    centralConfigPath?: string
  } = {},
): Promise<ProjectDeclarationLint> {
  const central: CentralLayoutValues = {
    ...(sources.centralRunDirs ? { run_dirs: [...sources.centralRunDirs] } : {}),
    ...sources.central,
  }
  const project = centralProject(resolve(root), central)
  const deprecations = (declaration: ProjectDeclaration | null): ProjectDeclarationDiagnostic[] => {
    const conflicts = new Set(centralLayoutConflicts(project, declaration))
    const where = sources.centralConfigPath ?? 'the central configuration'
    return PROJECT_LAYOUT_KEYS.filter((key) => (central[key]?.length ?? 0) > 0).map((key) => ({
      code: CENTRAL_LAYOUT_DEPRECATED,
      severity: 'warning' as const,
      file: where,
      field: key,
      conflict: conflicts.has(key),
      message: conflicts.has(key)
        ? `central \`${key}\` conflicts with ${PROJECT_DECLARATION_RELPATH}; the central value wins until it is removed from ${where}`
        : `central \`${key}\` is project layout; keep it in ${PROJECT_DECLARATION_RELPATH} and remove it from ${where}`,
    }))
  }
  try {
    const declaration = await loadProjectDeclaration(root)
    const layout = selectProjectLayout({ project, declaration, cliRunDirs: sources.cliRunDirs })
    return {
      present: declaration !== null,
      declaration,
      effective: { patterns: layout.runDirs, source: layout.sources.run_dirs },
      layout,
      diagnostics: deprecations(declaration),
    }
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    return {
      present: true,
      declaration: null,
      effective: null,
      layout: null,
      diagnostics: [
        {
          code: error.code,
          severity: 'error',
          file: PROJECT_DECLARATION_RELPATH,
          ...(error.key === undefined ? {} : { field: error.key }),
          message: error.message,
        },
        ...deprecations(null),
      ],
    }
  }
}
