import 'server-only'

import { BackendDocumentServiceError, BackendProjectServiceError } from '@memon/backend'
import {
  BackendExperimentResponseSchema,
  BackendRunResponseSchema,
  type Config,
  type ProjectConfig,
} from '@memon/core'
import { readIdentityFromRequest } from './auth/request-context'
import { standaloneRequestContext } from './standalone-request-context'
import { standaloneServices } from './standalone-services'

/** Resolve legacy IDs on demand, with exact project selection and no guessed owner. */
export async function resolveStandaloneTarget<T>(
  config: Config,
  read: (project: string) => Promise<T>,
  selected?: string | null,
  allowedProjects?: ReadonlySet<string>,
): Promise<{ project: ProjectConfig; value: T }> {
  const scope = standaloneRequestContext()
  const identity = scope ? readIdentityFromRequest(scope.request) : undefined
  const allowed =
    allowedProjects ?? (identity?.role === 'viewer' ? identity.scopeProjects : undefined)
  const projects = config.projects.filter(
    (project) =>
      project.host === undefined &&
      (!selected || project.name === selected) &&
      (!allowed || allowed.has(project.name)),
  )
  const matches: Array<{ project: ProjectConfig; value: T }> = []
  for (const project of projects) {
    try {
      matches.push({ project, value: await read(project.name) })
    } catch (error) {
      if (
        (error instanceof BackendProjectServiceError ||
          error instanceof BackendDocumentServiceError) &&
        error.code === 'RESOURCE_NOT_FOUND'
      )
        continue
      throw error
    }
  }
  if (matches.length !== 1)
    throw new BackendProjectServiceError(
      matches.length ? 'INVALID_RESOURCE' : 'RESOURCE_NOT_FOUND',
      matches.length ? 'Resource is ambiguous; select a project' : 'Resource not found',
    )
  return matches[0]!
}

export function standaloneRunTarget(
  config: Config,
  id: string,
  selected?: string | null,
  allowedProjects?: ReadonlySet<string>,
) {
  return resolveStandaloneTarget(
    config,
    async (project) =>
      BackendRunResponseSchema.parse(await standaloneServices(config).projects.getRun(project, id)),
    selected,
    allowedProjects,
  )
}

export function standaloneExperimentTarget(
  config: Config,
  id: string,
  selected?: string | null,
  allowedProjects?: ReadonlySet<string>,
) {
  return resolveStandaloneTarget(
    config,
    async (project) =>
      BackendExperimentResponseSchema.parse(
        await standaloneServices(config).projects.getExperiment(project, id),
      ),
    selected,
    allowedProjects,
  )
}
