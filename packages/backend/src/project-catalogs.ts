import {
  type ProjectCatalog,
  type ProjectCatalogKind,
  ProjectCatalogSchema,
  type ProjectConfig,
  projectFs,
} from '@memon/core'
import { isFileAccessError } from '@memon/file-protocol'
import { join } from '@memon/file-protocol/paths'
import { resolveContained } from './containment.js'
import { isRegisteredProject } from './registered-index.js'

export class ProjectCatalogError extends Error {
  constructor(kind: ProjectCatalogKind, cause?: unknown) {
    super(`PROJECT_CATALOG_UNAVAILABLE: ${kind}; run memon refresh at the project source`, {
      cause,
    })
    this.name = 'ProjectCatalogError'
  }
}

/** Catalog identity is shared by navigation and detail; no fallback walk. */
export async function registeredCatalog(
  project: ProjectConfig,
  kind: ProjectCatalogKind,
): Promise<ProjectCatalog | null> {
  if (!(await isRegisteredProject(project))) return null
  try {
    const path = await resolveContained(
      project.root,
      join(project.root, `.memon/index/${kind}.json`),
    )
    if (!path) throw new Error('missing catalog')
    const parsed = ProjectCatalogSchema.parse(JSON.parse(await projectFs.readFile(path, 'utf8')))
    if (parsed.kind !== kind) throw new Error('catalog kind mismatch')
    return parsed
  } catch (error) {
    if (isFileAccessError(error)) throw error
    throw new ProjectCatalogError(kind, error)
  }
}
