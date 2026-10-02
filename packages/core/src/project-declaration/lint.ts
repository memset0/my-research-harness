// `memon project lint`: validate `.memon/project.yml` and report the
// effective Run locations with their source.

import { type EffectiveRunDirs, loadProjectDeclaration, selectEffectiveRunDirs } from './load.js'
import { PROJECT_DECLARATION_RELPATH } from './paths.js'
import { type ProjectDeclaration, ProjectDeclarationError } from './schema.js'

export interface ProjectDeclarationDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'
  file: string
  field?: string
  message: string
}

export interface ProjectDeclarationLint {
  /** Whether `.memon/project.yml` exists. */
  present: boolean
  /** The validated declaration (null when absent or invalid). */
  declaration: ProjectDeclaration | null
  /** Effective Run locations; null when the declaration is invalid (fail closed). */
  effective: EffectiveRunDirs | null
  diagnostics: ProjectDeclarationDiagnostic[]
}

/** Validate the declaration of `root` and resolve the effective `run_dirs`. */
export async function lintProjectDeclaration(
  root: string,
  sources: { cliRunDirs?: readonly string[]; centralRunDirs?: readonly string[] } = {},
): Promise<ProjectDeclarationLint> {
  try {
    const declaration = await loadProjectDeclaration(root)
    return {
      present: declaration !== null,
      declaration,
      effective: selectEffectiveRunDirs({ ...sources, declaration }),
      diagnostics: [],
    }
  } catch (error) {
    if (!(error instanceof ProjectDeclarationError)) throw error
    return {
      present: true,
      declaration: null,
      effective: null,
      diagnostics: [
        {
          code: error.code,
          severity: 'error',
          file: PROJECT_DECLARATION_RELPATH,
          ...(error.key === undefined ? {} : { field: error.key }),
          message: error.message,
        },
      ],
    }
  }
}
