// memon hypotheses read — agent-shaped mirror of /api/hypotheses.

import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { parseHypotheses } from '@memon/core'
import { resolveContext, singleProjectRoot } from '../lib/context.js'
import { emitJson } from '../lib/output.js'

export interface HypothesesReadInput {
  projectRoot?: string
  configPath?: string
  cwd: string
}

export async function runHypothesesRead(input: HypothesesReadInput): Promise<void> {
  const ctx = await resolveContext(input)
  const root = singleProjectRoot(ctx)
  const hypPath = join(root, 'HYPOTHESES.md')

  try {
    const content = await fs.readFile(hypPath, 'utf8')
    const parsed = parseHypotheses(content)
    emitJson({ path: hypPath, ...parsed })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      emitJson({
        path: null,
        legendBlock: null,
        summaryTableBlock: null,
        entries: [],
        parseErrors: [],
        parseWarnings: [],
      })
      return
    }
    throw err
  }
}
