import 'server-only'

import type { Runtime } from '../runtime'
import { standaloneServices } from '../standalone-services'
import {
  resolveStandaloneTarget,
  standaloneExperimentTarget,
  standaloneRunTarget,
} from '../standalone-target'
import { classifyAndExtract, type ProjectResolverContext } from './route-classes'

/** Configuration-only resolver for classification before authentication. */
export function makeProjectResolver(runtime: Runtime): ProjectResolverContext {
  const names = new Set(runtime.config.projects.map((project) => project.name))
  return {
    isKnownProject: (name) => names.has(name),
    resolveByRunId: () => null,
    resolveByExperimentId: () => null,
    resolveByReportId: () => null,
    resolveByWikiId: () => null,
    resolveByPath: (path) => runtime.projectFor(path)?.name ?? null,
  }
}

/** Only authenticated legacy ID requests need source-backed owner resolution. */
export async function resolveRequestProject(
  runtime: Runtime,
  method: string,
  pathname: string,
  search: URLSearchParams,
  allowedProjects?: ReadonlySet<string>,
) {
  const context = makeProjectResolver(runtime)
  let lookup: (() => Promise<string>) | undefined
  const choose = (read: () => Promise<{ project: { name: string } }>) => {
    lookup = async () => (await read()).project.name
    return null
  }
  context.resolveByRunId = (id) =>
    choose(() => standaloneRunTarget(runtime.config, id, undefined, allowedProjects))
  context.resolveByExperimentId = (id) =>
    choose(() => standaloneExperimentTarget(runtime.config, id, undefined, allowedProjects))
  context.resolveByReportId = (id) =>
    choose(() =>
      resolveStandaloneTarget(
        runtime.config,
        (project) => standaloneServices(runtime.config).documents.getReport(project, id),
        undefined,
        allowedProjects,
      ),
    )
  context.resolveByWikiId = (id) =>
    choose(() =>
      resolveStandaloneTarget(
        runtime.config,
        (project) => standaloneServices(runtime.config).documents.getWiki(project, id),
        undefined,
        allowedProjects,
      ),
    )
  const result = classifyAndExtract(method, pathname, search, context)
  if (!lookup) return result.project
  try {
    return await lookup()
  } catch {
    return null
  }
}
