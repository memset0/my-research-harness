// In-memory ExperimentIndex used by both CLI commands and the web backend.
//
// Keyed by experiment id (= directory base name). Multiple projects share one
// index; the top-level `project` field on each Experiment (set by discovery
// from the matching `config.yml` project's `name`) partitions queries.
// `frontMatter.project` is a separate sub-project label and is NOT used for
// membership filtering — only as a search haystack.
//
// Operations are intentionally synchronous — discovery / parsing happens
// elsewhere and produces ready-to-insert Experiment values.

import type { Experiment } from '../types.js'

export type SearchScope = 'all' | 'body' | 'fm'

export interface ListFilter {
  project?: string
}

export class ExperimentIndex {
  private byId = new Map<string, Experiment>()

  set(experiment: Experiment): void {
    this.byId.set(experiment.id, experiment)
  }

  delete(id: string): boolean {
    return this.byId.delete(id)
  }

  get(id: string): Experiment | undefined {
    return this.byId.get(id)
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  size(): number {
    return this.byId.size
  }

  clear(): void {
    this.byId.clear()
  }

  /**
   * List experiments. Default sort: createdAt desc (most recent first).
   * Empty createdAt sorts to the end.
   */
  list(filter: ListFilter = {}): Experiment[] {
    const all = Array.from(this.byId.values())
    const filtered = filter.project
      ? all.filter((e) => e.project === filter.project)
      : all
    return filtered.sort(byCreatedAtDesc)
  }

  search(query: string, scope: SearchScope = 'all'): Experiment[] {
    if (query === '') return this.list()
    const needle = query.toLowerCase()
    return this.list().filter((exp) => matchesQuery(exp, needle, scope))
  }
}

// ---------- helpers ----------

function byCreatedAtDesc(a: Experiment, b: Experiment): number {
  const at = a.frontMatter.createdAt
  const bt = b.frontMatter.createdAt
  if (at === '' && bt === '') return 0
  if (at === '') return 1
  if (bt === '') return -1
  if (at > bt) return -1
  if (at < bt) return 1
  return 0
}

function matchesQuery(exp: Experiment, needle: string, scope: SearchScope): boolean {
  if (scope === 'all' || scope === 'fm') {
    if (haystackContains(exp.frontMatter.id, needle)) return true
    if (haystackContains(exp.frontMatter.name, needle)) return true
    // Match BOTH the membership project (top-level) and the front-matter
    // sub-project label, so searches surface experiments by either sense.
    if (haystackContains(exp.project, needle)) return true
    if (haystackContains(exp.frontMatter.project, needle)) return true
    if (haystackContains(exp.frontMatter.command, needle)) return true
    for (const t of exp.frontMatter.tags) if (haystackContains(t, needle)) return true
    for (const h of exp.frontMatter.hypotheses) if (haystackContains(h, needle)) return true
  }
  if (scope === 'all' || scope === 'body') {
    if (haystackContains(exp.body, needle)) return true
  }
  return false
}

function haystackContains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle)
}
