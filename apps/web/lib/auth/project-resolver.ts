// Build a ProjectResolverContext from a live Runtime. Centralized so
// middleware + route-classes can do id-to-project lookups via one helper.

import type { Runtime } from '../runtime'
import type { ProjectResolverContext } from './route-classes'

export function makeProjectResolver(runtime: Runtime): ProjectResolverContext {
  const projectNames = new Set(runtime.config.projects.map((p) => p.name))

  const resolveByRunId = (id: string): string | null => {
    const run = runtime.index.get(id)
    return run ? run.project : null
  }

  const resolveByExperimentId = (id: string): string | null => {
    const exp = runtime.experiments.get(id)
    return exp ? exp.project : null
  }

  const resolveByReportId = (id: string): string | null => {
    for (const project of runtime.config.projects) {
      const dir = runtime.reportsDir(project.name)
      if (!dir) continue
      const entries = runtime.reportsCache.getList(dir)
      for (const entry of entries) {
        if (entry.id === id) return project.name
      }
    }
    return null
  }

  const resolveByWikiId = (id: string): string | null => {
    for (const project of runtime.config.projects) {
      if (runtime.wikiCache.getWikiSummary(project.name, id)) return project.name
    }
    return null
  }

  const resolveByPath = (path: string): string | null => {
    if (!path) return null
    // Try absolute path first.
    const proj = runtime.projectFor(path)
    if (proj) return proj.name
    return null
  }

  return {
    isKnownProject: (name) => projectNames.has(name),
    resolveByRunId,
    resolveByExperimentId,
    resolveByReportId,
    resolveByWikiId,
    resolveByPath,
  }
}
