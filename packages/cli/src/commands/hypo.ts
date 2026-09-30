// `memon hypo list [--project NAME] [--format json|human]`
// `memon hypo show <H#> [--project NAME] [--format json|human]`

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { isId, parseHypotheses, type Hypothesis } from '@memon/core'
import { resolveConfig } from '../lib/resolver.js'
import {
  emitError,
  emitJson,
  emitHuman,
  formatHypothesisTable,
  type OutputFormat,
} from '../lib/output.js'

export interface HypoListOptions {
  project?: string
  format: OutputFormat
  projectRoot?: string
  cwd: string
}

export interface HypoShowOptions extends HypoListOptions {
  id: string
}

export async function runHypoList(opts: HypoListOptions): Promise<void> {
  const all = await collectHypotheses(opts)
  if (opts.format === 'human') {
    emitHuman(formatHypothesisTable(all.map((entry) => entry.hypothesis)))
    return
  }
  emitJson({
    hypotheses: all.map(({ project, hypothesis }) => ({ project, ...hypothesis })),
  })
}

export async function runHypoShow(opts: HypoShowOptions): Promise<void> {
  if (!isId(opts.id, 'H')) {
    const message = `hypothesis id must be canonical 4-digit form (e.g. H0003); got "${opts.id}"`
    if (opts.format === 'json') {
      emitJson({ error: { code: 'BAD_REQUEST', message } })
      process.exit(2)
    }
    emitError(message, 2)
  }
  const all = await collectHypotheses(opts)
  const match = all.find((e) => e.hypothesis.id === opts.id)
  if (!match) {
    if (opts.format === 'json') {
      emitJson({ error: { code: 'NOT_FOUND', message: `hypothesis "${opts.id}" not found` } })
      process.exit(1)
    }
    emitError(`hypothesis "${opts.id}" not found`, 1)
  }
  if (opts.format === 'human') {
    emitHuman(JSON.stringify(match.hypothesis, null, 2))
    return
  }
  emitJson({ project: match.project, ...match.hypothesis })
}

interface CollectedEntry {
  project: string
  hypothesis: Hypothesis
}

async function collectHypotheses(opts: HypoListOptions): Promise<CollectedEntry[]> {
  const config = await resolveConfig({
    projectRoot: opts.projectRoot,
    cwd: opts.cwd,
  })
  const out: CollectedEntry[] = []
  for (const project of config.projects) {
    if (opts.project && project.name !== opts.project) continue
    const path = join(project.root, 'docs', 'hypotheses.md')
    let content: string
    try {
      content = await fs.readFile(path, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue
      throw err
    }
    const parsed = parseHypotheses(content)
    for (const h of parsed.entries) out.push({ project: project.name, hypothesis: h })
  }
  return out
}
