// Server-side data fetchers used by SSR prefetch.
//
// These mirror the JSON shape returned by /api/* routes so that prefetched
// data slot directly into the same TanStack Query keys used by the client
// (`fetchProjects` / `fetchExperiments` / etc.). Reading from the runtime
// in-memory index here is faster than a self-loopback HTTP call.

import 'server-only'

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isStaleRunning, parseHypotheses, parseJournal } from '@memon/core'
import { getRuntime } from '../runtime'
import type {
  FullExperiment,
  IndexedExperiment,
  ProjectSummary,
} from '../api'

export async function getProjectsData(): Promise<{ projects: ProjectSummary[] }> {
  const rt = await getRuntime()
  return {
    projects: rt.config.projects.map((p) => ({
      name: p.name,
      root: p.root,
      exclude: p.exclude,
    })),
  }
}

export async function getExperimentsData(
  project?: string,
): Promise<{ experiments: IndexedExperiment[] }> {
  const rt = await getRuntime()
  const experiments = rt.index.list({ project })
  return {
    experiments: experiments.map((e) => ({
      id: e.id,
      path: e.path,
      mtime: e.mtime,
      hasReadme: e.hasReadme,
      frontMatter: e.frontMatter,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
      stale: isStaleRunning(e),
    })),
  }
}

export async function getExperimentData(id: string): Promise<FullExperiment | null> {
  const rt = await getRuntime()
  const exp = rt.index.get(id)
  if (!exp) return null
  // Touch the poller so the next backend GET refreshes promptly
  rt.pokeById(id)
  return {
    id: exp.id,
    path: exp.path,
    mtime: exp.mtime,
    hasReadme: exp.hasReadme,
    frontMatter: exp.frontMatter,
    sections: exp.sections,
    body: exp.body,
    parseErrors: exp.parseErrors,
    parseWarnings: exp.parseWarnings,
    stale: isStaleRunning(exp),
    resources: null,
  }
}

export async function getHypothesesData(project: string) {
  const rt = await getRuntime()
  const projectCfg = rt.config.projects.find((p) => p.name === project)
  if (!projectCfg) {
    return {
      path: '',
      legendBlock: null,
      summaryTableBlock: null,
      entries: [],
      parseErrors: [],
      parseWarnings: [],
    }
  }
  const path = join(projectCfg.root, 'HYPOTHESES.md')
  let content: string
  try {
    content = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        path,
        legendBlock: null,
        summaryTableBlock: null,
        entries: [],
        parseErrors: [],
        parseWarnings: [],
      }
    }
    throw err
  }
  const parsed = parseHypotheses(content)
  return { path, ...parsed }
}

export async function getJournalData(
  project: string,
  options: { limit?: number; before?: string } = {},
) {
  const rt = await getRuntime()
  const projectCfg = rt.config.projects.find((p) => p.name === project)
  if (!projectCfg) {
    return { path: '', lastDigestAt: null, events: [], parseErrors: [], parseWarnings: [] }
  }
  const path = join(projectCfg.root, 'JOURNAL.md')
  let content: string
  try {
    content = await fs.readFile(path, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, lastDigestAt: null, events: [], parseErrors: [], parseWarnings: [] }
    }
    throw err
  }
  const parsed = parseJournal(content)
  let events = [...parsed.events].reverse()
  const before = options.before
  if (before) events = events.filter((e) => e.timestamp < before)
  const limit = options.limit ?? Number.POSITIVE_INFINITY
  if (Number.isFinite(limit)) events = events.slice(0, limit)
  return {
    path,
    lastDigestAt: parsed.lastDigestAt,
    events,
    parseErrors: parsed.parseErrors,
    parseWarnings: parsed.parseWarnings,
  }
}
