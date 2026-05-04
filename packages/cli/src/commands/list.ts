// `memon list [--project NAME] [--format json|human]`

import { resolveConfig } from '../lib/resolver.js'
import { buildIndex } from '../lib/index-builder.js'
import { emitJson, emitHuman, formatExperimentTable, type OutputFormat } from '../lib/output.js'

export interface ListOptions {
  project?: string
  format: OutputFormat
  projectRoot?: string
  cwd: string
}

export async function runList(opts: ListOptions): Promise<void> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const idx = await buildIndex(config, { project: opts.project })
  const experiments = idx.list({ project: opts.project })

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
      frontMatter: e.frontMatter,
      parseErrors: e.parseErrors,
      parseWarnings: e.parseWarnings,
    })),
  })
}
