// `memon list [--project NAME] [--format json|human]`

import { buildIndex } from '../lib/index-builder.js'
import { emitHuman, emitJson, formatExperimentTable, type OutputFormat } from '../lib/output.js'
import { resolveConfig } from '../lib/resolver.js'

export interface ListOptions {
  project?: string
  format: OutputFormat
  projectRoot?: string
  cwd: string
  /** Include runs marked deprecated (default: excluded). */
  includeDeprecated?: boolean
  /** Return only runs marked deprecated. */
  deprecatedOnly?: boolean
}

export async function runList(opts: ListOptions): Promise<void> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const idx = await buildIndex(config, { project: opts.project })
  // Deprecation filtering lives in the index so "excluded by default" means
  // the same thing in the CLI, the scan and the web backend.
  const experiments = idx.list({
    project: opts.project,
    includeDeprecated: opts.includeDeprecated,
    deprecatedOnly: opts.deprecatedOnly,
  })

  if (opts.format === 'human') {
    emitHuman(formatExperimentTable(experiments))
    return
  }

  emitJson({
    experiments: experiments.map((e) => ({
      id: e.id,
      path: e.path,
      mtime: e.mtime,
      hasReadme: e.hasReadme,
      deprecated: e.frontMatter.deprecated,
      frontMatter: e.frontMatter,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
    })),
  })
}
