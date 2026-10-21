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
import { missingOrThrow } from './missing-path.js'
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

/** Identity rules per catalog; only IDs that match are worth a source check. */
const DOCUMENT_ID: Record<ProjectCatalogKind, RegExp> = {
  experiments: /^E\d{4}-[a-z0-9][a-z0-9-]*$/,
  wiki: /^W\d{4}$/,
  reports: /^R\d{4}$/,
}
const REPORT_NAME = /^R\d{4}-/

/**
 * After a catalog miss: does the source hold a document with this ID that was
 * never refreshed into the catalog? A malformed ID, or a Project that is not
 * catalog-backed, is answered without any I/O. Otherwise only the directories
 * the ID can live in are listed (Wiki kind directories; Reports and their
 * category directories; the Experiments directory) and no body is read.
 */
export async function hasUnrefreshedDocument(
  project: ProjectConfig,
  kind: ProjectCatalogKind,
  id: string,
): Promise<boolean> {
  if (!DOCUMENT_ID[kind].test(id) || !(await isRegisteredProject(project))) return false
  const list = async (relative: string) => {
    const path = await resolveContained(project.root, relative, { allowMissing: true })
    if (!path) return []
    return (await missingOrThrow(projectFs.readdir(path, { withFileTypes: true }))) ?? []
  }
  const named = (name: string) => name.startsWith(`${id}-`)
  if (kind === 'experiments') {
    const entries = await list('docs/experiments')
    return entries.some((entry) => entry.name === id || entry.name === `${id}.md`)
  }
  const top = kind === 'wiki' ? 'docs/wiki' : 'docs/reports'
  const entries = await list(top)
  if (kind === 'reports' && entries.some((entry) => named(entry.name))) return true
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    if (kind === 'reports' && REPORT_NAME.test(entry.name)) continue
    if ((await list(`${top}/${entry.name}`)).some((child) => named(child.name))) return true
  }
  return false
}
