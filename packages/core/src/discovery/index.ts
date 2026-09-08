// In-memory RunIndex used by both CLI commands and the web backend.
//
// Keyed by experiment id (= directory base name). Multiple projects share one
// index; the top-level `project` field on each Run (set by discovery
// from the matching `config.yml` project's `name`) partitions queries.
// `frontMatter.project` is a separate sub-project label and is NOT used for
// membership filtering — only as a search haystack.
//
// Operations are intentionally synchronous — discovery / parsing happens
// elsewhere and produces ready-to-insert Run values.

import type { Run } from '../types.js'

export type SearchScope = 'all' | 'body' | 'fm'

export interface ListFilter {
  project?: string
  /**
   * v6: include deprecated runs in the collection. Default false — a
   * deprecated Run is excluded from every research listing, search result,
   * and count, while `get`/`has` keep serving it by explicit id.
   */
  includeDeprecated?: boolean
  /**
   * v6: return ONLY deprecated runs (the "what did we throw out" view).
   * Implies inclusion; takes precedence over `includeDeprecated`.
   */
  deprecatedOnly?: boolean
}

/**
 * Does this run pass the deprecation half of a filter? Shared by the index,
 * the project scan, and CLI/service listings so "excluded by default" means
 * the same thing everywhere.
 */
export function matchesRunDeprecationFilter(
  deprecated: boolean,
  filter: Pick<ListFilter, 'includeDeprecated' | 'deprecatedOnly'> = {},
): boolean {
  if (filter.deprecatedOnly) return deprecated
  return filter.includeDeprecated === true || !deprecated
}

export class RunIndex {
  private byId = new Map<string, Run>()

  set(experiment: Run): void {
    this.byId.set(experiment.id, experiment)
  }

  delete(id: string): boolean {
    return this.byId.delete(id)
  }

  get(id: string): Run | undefined {
    return this.byId.get(id)
  }

  has(id: string): boolean {
    return this.byId.has(id)
  }

  /**
   * Number of runs currently indexed, regardless of deprecation. This is
   * index cardinality, not a research count — use `count(filter)` for the
   * latter.
   */
  size(): number {
    return this.byId.size
  }

  /**
   * Research count: how many runs a `list(filter)` would return. Deprecated
   * runs are excluded unless the filter asks for them.
   */
  count(filter: ListFilter = {}): number {
    let total = 0
    for (const run of this.byId.values()) {
      if (filter.project !== undefined && run.project !== filter.project) continue
      if (!matchesRunDeprecationFilter(run.frontMatter.deprecated, filter)) continue
      total += 1
    }
    return total
  }

  clear(): void {
    this.byId.clear()
  }

  /**
   * List runs. Default sort: createdAt desc (most recent first); empty
   * createdAt sorts to the end. Deprecated runs are excluded unless the
   * filter opts in.
   */
  list(filter: ListFilter = {}): Run[] {
    const filtered: Run[] = []
    for (const run of this.byId.values()) {
      if (filter.project !== undefined && run.project !== filter.project) continue
      if (!matchesRunDeprecationFilter(run.frontMatter.deprecated, filter)) continue
      filtered.push(run)
    }
    return filtered.sort(byCreatedAtDesc)
  }

  /**
   * Search runs. Inherits `list`'s deprecation policy: deprecated runs stay
   * out of results unless the filter opts in.
   */
  search(query: string, scope: SearchScope = 'all', filter: ListFilter = {}): Run[] {
    if (query === '') return this.list(filter)
    const needle = query.toLowerCase()
    return this.list(filter).filter((exp) => matchesQuery(exp, needle, scope))
  }
}

// ---------- helpers ----------

function byCreatedAtDesc(a: Run, b: Run): number {
  const at = a.frontMatter.createdAt
  const bt = b.frontMatter.createdAt
  if (at === '' && bt === '') return 0
  if (at === '') return 1
  if (bt === '') return -1
  if (at > bt) return -1
  if (at < bt) return 1
  return 0
}

function matchesQuery(exp: Run, needle: string, scope: SearchScope): boolean {
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
