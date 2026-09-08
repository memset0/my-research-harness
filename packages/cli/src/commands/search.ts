// `memon search <query> [--in body|fm|all] [--format json|human]`
//
// JSON output includes per-match snippet excerpts (~120 chars around the
// first hit per haystack); human output renders a compact table.

import { resolveConfig } from '../lib/resolver.js'
import { buildIndex } from '../lib/index-builder.js'
import { emitJson, emitHuman, formatExperimentTable, type OutputFormat } from '../lib/output.js'

export interface SearchOptions {
  query: string
  scope: 'all' | 'body' | 'fm'
  format: OutputFormat
  projectRoot?: string
  cwd: string
  /** Include runs marked deprecated (default: excluded). */
  includeDeprecated?: boolean
  /** Match only runs marked deprecated. */
  deprecatedOnly?: boolean
}

export async function runSearch(opts: SearchOptions): Promise<void> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const idx = await buildIndex(config)
  const matches = idx.search(opts.query, opts.scope, {
    includeDeprecated: opts.includeDeprecated,
    deprecatedOnly: opts.deprecatedOnly,
  })

  if (opts.format === 'human') {
    emitHuman(formatExperimentTable(matches))
    return
  }

  emitJson({
    query: opts.query,
    scope: opts.scope,
    matches: matches.map((e) => ({
      id: e.id,
      // Membership project (config-derived) — what `memon list --project X`
      // and the web /api/experiments?project=X filter on.
      project: e.project,
      // Optional sub-project label from front matter; null when absent or
      // identical to the membership project.
      subProject:
        e.frontMatter.project !== '' && e.frontMatter.project !== e.project
          ? e.frontMatter.project
          : null,
      status: e.frontMatter.status,
      deprecated: e.frontMatter.deprecated,
      name: e.frontMatter.name,
      snippet: snippet(e.body, opts.query),
    })),
  })
}

function snippet(haystack: string, needle: string): string | null {
  if (!haystack || !needle) return null
  const idx = haystack.toLowerCase().indexOf(needle.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - 60)
  const end = Math.min(haystack.length, idx + needle.length + 60)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < haystack.length ? '…' : ''
  return `${prefix}${haystack.slice(start, end).replace(/\n/g, ' ')}${suffix}`
}
